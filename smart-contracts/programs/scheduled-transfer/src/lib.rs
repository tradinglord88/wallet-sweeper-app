/*!
 * Scheduled Transfer Program for Solana
 *
 * A secure smart contract for time-delayed and conditional transfers with comprehensive
 * security measures including replay protection, access control, and audit logging.
 */

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use std::mem::size_of;

declare_id!("SchdTrnsfrProgram11111111111111111111111111");

#[program]
pub mod scheduled_transfer {
    use super::*;

    /// Schedule a transfer to be executed after a specific timestamp
    pub fn schedule_transfer(
        ctx: Context<ScheduleTransfer>,
        amount: u64,
        execute_after: i64,
        nonce: [u8; 32],
        memo: String,
    ) -> Result<()> {
        let transfer_account = &mut ctx.accounts.transfer_account;
        let sender = &ctx.accounts.sender;
        let clock = Clock::get()?;

        // Security validations
        require!(amount > 0, TransferError::InvalidAmount);
        require!(execute_after > clock.unix_timestamp, TransferError::InvalidExecutionTime);
        require!(memo.len() <= 200, TransferError::MemoTooLong);

        // Validate execution time is not too far in the future (max 30 days)
        let max_future_time = clock.unix_timestamp + (30 * 24 * 60 * 60);
        require!(execute_after <= max_future_time, TransferError::ExecutionTimeTooFar);

        // Initialize the scheduled transfer
        transfer_account.sender = sender.key();
        transfer_account.recipient = ctx.accounts.recipient.key();
        transfer_account.amount = amount;
        transfer_account.token_mint = ctx.accounts.token_mint.key();
        transfer_account.execute_after = execute_after;
        transfer_account.created_at = clock.unix_timestamp;
        transfer_account.executed = false;
        transfer_account.cancelled = false;
        transfer_account.nonce = nonce;
        transfer_account.memo = memo;
        transfer_account.bump = *ctx.bumps.get("transfer_account").unwrap();

        // Transfer tokens to escrow
        if ctx.accounts.token_mint.key() == System::id() {
            // SOL transfer to escrow
            let transfer_instruction = anchor_lang::system_program::Transfer {
                from: sender.to_account_info(),
                to: transfer_account.to_account_info(),
            };

            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    transfer_instruction,
                ),
                amount,
            )?;
        } else {
            // SPL Token transfer to escrow
            let transfer_instruction = Transfer {
                from: ctx.accounts.sender_token_account.to_account_info(),
                to: ctx.accounts.escrow_token_account.to_account_info(),
                authority: sender.to_account_info(),
            };

            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    transfer_instruction,
                ),
                amount,
            )?;
        }

        emit!(TransferScheduled {
            transfer_id: transfer_account.key(),
            sender: sender.key(),
            recipient: ctx.accounts.recipient.key(),
            amount,
            token_mint: ctx.accounts.token_mint.key(),
            execute_after,
            nonce,
        });

        Ok(())
    }

    /// Execute a scheduled transfer after the execution time has passed
    pub fn execute_scheduled_transfer(
        ctx: Context<ExecuteScheduledTransfer>,
    ) -> Result<()> {
        let transfer_account = &mut ctx.accounts.transfer_account;
        let clock = Clock::get()?;

        // Security validations
        require!(!transfer_account.executed, TransferError::AlreadyExecuted);
        require!(!transfer_account.cancelled, TransferError::TransferCancelled);
        require!(
            clock.unix_timestamp >= transfer_account.execute_after,
            TransferError::ExecutionTimeNotReached
        );

        // Verify recipient matches
        require!(
            transfer_account.recipient == ctx.accounts.recipient.key(),
            TransferError::InvalidRecipient
        );

        // Mark as executed before transfer to prevent reentrancy
        transfer_account.executed = true;
        transfer_account.executed_at = clock.unix_timestamp;

        // Execute the transfer
        if transfer_account.token_mint == System::id() {
            // SOL transfer from escrow
            let transfer_lamports = transfer_account.amount;

            **transfer_account.to_account_info().try_borrow_mut_lamports()? -= transfer_lamports;
            **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += transfer_lamports;

        } else {
            // SPL Token transfer from escrow
            let seeds = &[
                b"transfer",
                transfer_account.sender.as_ref(),
                transfer_account.nonce.as_ref(),
                &[transfer_account.bump],
            ];
            let signer = &[&seeds[..]];

            let transfer_instruction = Transfer {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: transfer_account.to_account_info(),
            };

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    transfer_instruction,
                    signer,
                ),
                transfer_account.amount,
            )?;
        }

        emit!(TransferExecuted {
            transfer_id: transfer_account.key(),
            sender: transfer_account.sender,
            recipient: transfer_account.recipient,
            amount: transfer_account.amount,
            token_mint: transfer_account.token_mint,
            executed_at: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Cancel a scheduled transfer (only by sender before execution)
    pub fn cancel_scheduled_transfer(
        ctx: Context<CancelScheduledTransfer>,
    ) -> Result<()> {
        let transfer_account = &mut ctx.accounts.transfer_account;
        let sender = &ctx.accounts.sender;

        // Security validations
        require!(!transfer_account.executed, TransferError::AlreadyExecuted);
        require!(!transfer_account.cancelled, TransferError::AlreadyCancelled);
        require!(
            transfer_account.sender == sender.key(),
            TransferError::UnauthorizedCancellation
        );

        // Mark as cancelled
        transfer_account.cancelled = true;
        transfer_account.cancelled_at = Clock::get()?.unix_timestamp;

        // Refund tokens to sender
        if transfer_account.token_mint == System::id() {
            // SOL refund
            let refund_lamports = transfer_account.amount;

            **transfer_account.to_account_info().try_borrow_mut_lamports()? -= refund_lamports;
            **sender.to_account_info().try_borrow_mut_lamports()? += refund_lamports;

        } else {
            // SPL Token refund
            let seeds = &[
                b"transfer",
                transfer_account.sender.as_ref(),
                transfer_account.nonce.as_ref(),
                &[transfer_account.bump],
            ];
            let signer = &[&seeds[..]];

            let transfer_instruction = Transfer {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.sender_token_account.to_account_info(),
                authority: transfer_account.to_account_info(),
            };

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    transfer_instruction,
                    signer,
                ),
                transfer_account.amount,
            )?;
        }

        emit!(TransferCancelled {
            transfer_id: transfer_account.key(),
            sender: transfer_account.sender,
            amount: transfer_account.amount,
            cancelled_at: transfer_account.cancelled_at,
        });

        Ok(())
    }

    /// Get transfer information (view function)
    pub fn get_transfer_info(
        ctx: Context<GetTransferInfo>,
    ) -> Result<TransferInfo> {
        let transfer_account = &ctx.accounts.transfer_account;

        Ok(TransferInfo {
            sender: transfer_account.sender,
            recipient: transfer_account.recipient,
            amount: transfer_account.amount,
            token_mint: transfer_account.token_mint,
            execute_after: transfer_account.execute_after,
            created_at: transfer_account.created_at,
            executed: transfer_account.executed,
            executed_at: transfer_account.executed_at,
            cancelled: transfer_account.cancelled,
            cancelled_at: transfer_account.cancelled_at,
            memo: transfer_account.memo.clone(),
        })
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, execute_after: i64, nonce: [u8; 32])]
pub struct ScheduleTransfer<'info> {
    #[account(
        init,
        payer = sender,
        space = 8 + ScheduledTransfer::INIT_SPACE,
        seeds = [b"transfer", sender.key().as_ref(), nonce.as_ref()],
        bump
    )]
    pub transfer_account: Account<'info, ScheduledTransfer>,

    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: This is validated in the instruction
    pub recipient: AccountInfo<'info>,

    /// CHECK: Token mint account
    pub token_mint: AccountInfo<'info>,

    #[account(
        mut,
        constraint = sender_token_account.owner == sender.key() @ TransferError::InvalidTokenAccount,
        constraint = sender_token_account.mint == token_mint.key() @ TransferError::InvalidTokenMint
    )]
    pub sender_token_account: Option<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = sender,
        associated_token::mint = token_mint,
        associated_token::authority = transfer_account
    )]
    pub escrow_token_account: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ExecuteScheduledTransfer<'info> {
    #[account(
        mut,
        seeds = [b"transfer", transfer_account.sender.as_ref(), transfer_account.nonce.as_ref()],
        bump = transfer_account.bump
    )]
    pub transfer_account: Account<'info, ScheduledTransfer>,

    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == transfer_account.key() @ TransferError::InvalidEscrowAccount
    )]
    pub escrow_token_account: Option<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == recipient.key() @ TransferError::InvalidTokenAccount
    )]
    pub recipient_token_account: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelScheduledTransfer<'info> {
    #[account(
        mut,
        seeds = [b"transfer", transfer_account.sender.as_ref(), transfer_account.nonce.as_ref()],
        bump = transfer_account.bump
    )]
    pub transfer_account: Account<'info, ScheduledTransfer>,

    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        constraint = sender_token_account.owner == sender.key() @ TransferError::InvalidTokenAccount
    )]
    pub sender_token_account: Option<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == transfer_account.key() @ TransferError::InvalidEscrowAccount
    )]
    pub escrow_token_account: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetTransferInfo<'info> {
    pub transfer_account: Account<'info, ScheduledTransfer>,
}

#[account]
#[derive(InitSpace)]
pub struct ScheduledTransfer {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub execute_after: i64,
    pub created_at: i64,
    pub executed: bool,
    pub executed_at: i64,
    pub cancelled: bool,
    pub cancelled_at: i64,
    pub nonce: [u8; 32],
    #[max_len(200)]
    pub memo: String,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransferInfo {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub execute_after: i64,
    pub created_at: i64,
    pub executed: bool,
    pub executed_at: i64,
    pub cancelled: bool,
    pub cancelled_at: i64,
    pub memo: String,
}

#[event]
pub struct TransferScheduled {
    pub transfer_id: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub execute_after: i64,
    pub nonce: [u8; 32],
}

#[event]
pub struct TransferExecuted {
    pub transfer_id: Pubkey,
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_mint: Pubkey,
    pub executed_at: i64,
}

#[event]
pub struct TransferCancelled {
    pub transfer_id: Pubkey,
    pub sender: Pubkey,
    pub amount: u64,
    pub cancelled_at: i64,
}

#[error_code]
pub enum TransferError {
    #[msg("Invalid transfer amount")]
    InvalidAmount,

    #[msg("Execution time must be in the future")]
    InvalidExecutionTime,

    #[msg("Execution time is too far in the future")]
    ExecutionTimeTooFar,

    #[msg("Execution time has not been reached")]
    ExecutionTimeNotReached,

    #[msg("Transfer has already been executed")]
    AlreadyExecuted,

    #[msg("Transfer has already been cancelled")]
    AlreadyCancelled,

    #[msg("Transfer has been cancelled")]
    TransferCancelled,

    #[msg("Unauthorized cancellation attempt")]
    UnauthorizedCancellation,

    #[msg("Invalid recipient")]
    InvalidRecipient,

    #[msg("Invalid token account")]
    InvalidTokenAccount,

    #[msg("Invalid token mint")]
    InvalidTokenMint,

    #[msg("Invalid escrow account")]
    InvalidEscrowAccount,

    #[msg("Memo is too long")]
    MemoTooLong,

    #[msg("Insufficient funds")]
    InsufficientFunds,

    #[msg("Clock unavailable")]
    ClockUnavailable,
}