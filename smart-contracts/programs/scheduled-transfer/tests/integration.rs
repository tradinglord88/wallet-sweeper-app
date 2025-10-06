/*!
 * Integration tests for the Scheduled Transfer Program
 */

use anchor_lang::prelude::*;
use anchor_spl::token::{TokenAccount, Mint};
use scheduled_transfer::{
    program::ScheduledTransfer as ScheduledTransferProgram,
    ScheduledTransfer, TransferError, TransferInfo,
};
use solana_program_test::*;
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
    clock::Clock,
    system_instruction,
};
use std::str::FromStr;

#[tokio::test]
async fn test_schedule_sol_transfer() {
    let mut program_test = ProgramTest::new(
        "scheduled_transfer",
        scheduled_transfer::id(),
        processor!(scheduled_transfer::entry),
    );

    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    let sender = Keypair::new();
    let recipient = Keypair::new();

    // Fund sender account
    let fund_sender_tx = Transaction::new_signed_with_payer(
        &[system_instruction::transfer(
            &payer.pubkey(),
            &sender.pubkey(),
            1_000_000_000, // 1 SOL
        )],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );

    banks_client.process_transaction(fund_sender_tx).await.unwrap();

    // Get current time and set execution time
    let clock = banks_client.get_sysvar::<Clock>().await.unwrap();
    let execute_after = clock.unix_timestamp + 60; // 1 minute from now

    let nonce = [1u8; 32];
    let amount = 500_000_000; // 0.5 SOL
    let memo = "Test scheduled transfer".to_string();

    // Derive transfer account PDA
    let (transfer_account, _bump) = Pubkey::find_program_address(
        &[b"transfer", sender.pubkey().as_ref(), nonce.as_ref()],
        &scheduled_transfer::id(),
    );

    // Create schedule transfer instruction
    let schedule_ix = anchor_lang::InstructionData::data(
        &scheduled_transfer::instruction::ScheduleTransfer {
            amount,
            execute_after,
            nonce,
            memo: memo.clone(),
        }
    );

    let accounts = scheduled_transfer::accounts::ScheduleTransfer {
        transfer_account,
        sender: sender.pubkey(),
        recipient: recipient.pubkey(),
        token_mint: solana_program::system_program::id(),
        sender_token_account: None,
        escrow_token_account: None,
        token_program: None,
        system_program: solana_program::system_program::id(),
        rent: solana_program::sysvar::rent::id(),
    };

    let schedule_tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id: scheduled_transfer::id(),
            accounts: anchor_lang::ToAccountMetas::to_account_metas(&accounts, None),
            data: schedule_ix,
        }],
        Some(&payer.pubkey()),
        &[&payer, &sender],
        recent_blockhash,
    );

    let result = banks_client.process_transaction(schedule_tx).await;
    assert!(result.is_ok(), "Failed to schedule transfer: {:?}", result);

    // Verify transfer account was created correctly
    let transfer_account_data = banks_client
        .get_account(transfer_account)
        .await
        .unwrap()
        .unwrap();

    let scheduled_transfer_data: ScheduledTransfer =
        ScheduledTransfer::try_deserialize(&mut &transfer_account_data.data[8..]).unwrap();

    assert_eq!(scheduled_transfer_data.sender, sender.pubkey());
    assert_eq!(scheduled_transfer_data.recipient, recipient.pubkey());
    assert_eq!(scheduled_transfer_data.amount, amount);
    assert_eq!(scheduled_transfer_data.execute_after, execute_after);
    assert_eq!(scheduled_transfer_data.memo, memo);
    assert!(!scheduled_transfer_data.executed);
    assert!(!scheduled_transfer_data.cancelled);
}

#[tokio::test]
async fn test_execute_sol_transfer_before_time() {
    let mut program_test = ProgramTest::new(
        "scheduled_transfer",
        scheduled_transfer::id(),
        processor!(scheduled_transfer::entry),
    );

    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    let sender = Keypair::new();
    let recipient = Keypair::new();

    // Fund and schedule transfer (similar to previous test)
    // ... (setup code omitted for brevity)

    // Try to execute before execution time
    let execute_ix = anchor_lang::InstructionData::data(
        &scheduled_transfer::instruction::ExecuteScheduledTransfer {}
    );

    let execute_tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id: scheduled_transfer::id(),
            accounts: anchor_lang::ToAccountMetas::to_account_metas(
                &scheduled_transfer::accounts::ExecuteScheduledTransfer {
                    transfer_account: transfer_account,
                    recipient: recipient.pubkey(),
                    escrow_token_account: None,
                    recipient_token_account: None,
                    token_program: None,
                    system_program: solana_program::system_program::id(),
                },
                None,
            ),
            data: execute_ix,
        }],
        Some(&payer.pubkey()),
        &[&payer, &recipient],
        recent_blockhash,
    );

    let result = banks_client.process_transaction(execute_tx).await;
    assert!(result.is_err(), "Should fail when executing before time");

    // Check that the error is ExecutionTimeNotReached
    if let Err(BanksClientError::TransactionError(TransactionError::InstructionError(
        _,
        InstructionError::Custom(error_code),
    ))) = result
    {
        assert_eq!(error_code, TransferError::ExecutionTimeNotReached as u32);
    } else {
        panic!("Expected ExecutionTimeNotReached error");
    }
}

#[tokio::test]
async fn test_cancel_scheduled_transfer() {
    let mut program_test = ProgramTest::new(
        "scheduled_transfer",
        scheduled_transfer::id(),
        processor!(scheduled_transfer::entry),
    );

    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    let sender = Keypair::new();
    let recipient = Keypair::new();

    // Setup and schedule transfer
    // ... (setup code)

    // Get sender balance before cancellation
    let sender_balance_before = banks_client
        .get_balance(sender.pubkey())
        .await
        .unwrap();

    // Cancel the transfer
    let cancel_ix = anchor_lang::InstructionData::data(
        &scheduled_transfer::instruction::CancelScheduledTransfer {}
    );

    let cancel_tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id: scheduled_transfer::id(),
            accounts: anchor_lang::ToAccountMetas::to_account_metas(
                &scheduled_transfer::accounts::CancelScheduledTransfer {
                    transfer_account: transfer_account,
                    sender: sender.pubkey(),
                    sender_token_account: None,
                    escrow_token_account: None,
                    token_program: None,
                    system_program: solana_program::system_program::id(),
                },
                None,
            ),
            data: cancel_ix,
        }],
        Some(&payer.pubkey()),
        &[&payer, &sender],
        recent_blockhash,
    );

    let result = banks_client.process_transaction(cancel_tx).await;
    assert!(result.is_ok(), "Failed to cancel transfer: {:?}", result);

    // Verify transfer was marked as cancelled
    let transfer_account_data = banks_client
        .get_account(transfer_account)
        .await
        .unwrap()
        .unwrap();

    let scheduled_transfer_data: ScheduledTransfer =
        ScheduledTransfer::try_deserialize(&mut &transfer_account_data.data[8..]).unwrap();

    assert!(scheduled_transfer_data.cancelled);
    assert!(!scheduled_transfer_data.executed);

    // Verify sender got refund
    let sender_balance_after = banks_client
        .get_balance(sender.pubkey())
        .await
        .unwrap();

    assert!(sender_balance_after > sender_balance_before);
}

#[tokio::test]
async fn test_unauthorized_cancellation() {
    let mut program_test = ProgramTest::new(
        "scheduled_transfer",
        scheduled_transfer::id(),
        processor!(scheduled_transfer::entry),
    );

    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    let sender = Keypair::new();
    let recipient = Keypair::new();
    let unauthorized_user = Keypair::new();

    // Setup and schedule transfer
    // ... (setup code)

    // Try to cancel with unauthorized user
    let cancel_ix = anchor_lang::InstructionData::data(
        &scheduled_transfer::instruction::CancelScheduledTransfer {}
    );

    let cancel_tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id: scheduled_transfer::id(),
            accounts: anchor_lang::ToAccountMetas::to_account_metas(
                &scheduled_transfer::accounts::CancelScheduledTransfer {
                    transfer_account: transfer_account,
                    sender: unauthorized_user.pubkey(), // Wrong signer
                    sender_token_account: None,
                    escrow_token_account: None,
                    token_program: None,
                    system_program: solana_program::system_program::id(),
                },
                None,
            ),
            data: cancel_ix,
        }],
        Some(&payer.pubkey()),
        &[&payer, &unauthorized_user],
        recent_blockhash,
    );

    let result = banks_client.process_transaction(cancel_tx).await;
    assert!(result.is_err(), "Should fail with unauthorized cancellation");

    if let Err(BanksClientError::TransactionError(TransactionError::InstructionError(
        _,
        InstructionError::Custom(error_code),
    ))) = result
    {
        assert_eq!(error_code, TransferError::UnauthorizedCancellation as u32);
    } else {
        panic!("Expected UnauthorizedCancellation error");
    }
}

#[tokio::test]
async fn test_replay_protection() {
    let mut program_test = ProgramTest::new(
        "scheduled_transfer",
        scheduled_transfer::id(),
        processor!(scheduled_transfer::entry),
    );

    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    let sender = Keypair::new();
    let recipient = Keypair::new();

    // Use the same nonce for two different transfers
    let nonce = [1u8; 32];

    // Fund sender
    let fund_sender_tx = Transaction::new_signed_with_payer(
        &[system_instruction::transfer(
            &payer.pubkey(),
            &sender.pubkey(),
            2_000_000_000, // 2 SOL
        )],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );

    banks_client.process_transaction(fund_sender_tx).await.unwrap();

    // Schedule first transfer
    let clock = banks_client.get_sysvar::<Clock>().await.unwrap();
    let execute_after = clock.unix_timestamp + 60;

    let schedule_first_transfer = create_schedule_transfer_tx(
        &sender,
        &recipient,
        nonce,
        500_000_000,
        execute_after,
        "First transfer".to_string(),
        &payer,
        recent_blockhash,
    );

    let result1 = banks_client.process_transaction(schedule_first_transfer).await;
    assert!(result1.is_ok(), "First transfer should succeed");

    // Try to schedule second transfer with same nonce
    let schedule_second_transfer = create_schedule_transfer_tx(
        &sender,
        &recipient,
        nonce, // Same nonce
        300_000_000,
        execute_after + 120,
        "Second transfer".to_string(),
        &payer,
        recent_blockhash,
    );

    let result2 = banks_client.process_transaction(schedule_second_transfer).await;
    assert!(result2.is_err(), "Second transfer with same nonce should fail");
}

#[tokio::test]
async fn test_execution_time_limits() {
    let mut program_test = ProgramTest::new(
        "scheduled_transfer",
        scheduled_transfer::id(),
        processor!(scheduled_transfer::entry),
    );

    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    let sender = Keypair::new();
    let recipient = Keypair::new();

    // Fund sender
    let fund_sender_tx = Transaction::new_signed_with_payer(
        &[system_instruction::transfer(
            &payer.pubkey(),
            &sender.pubkey(),
            1_000_000_000,
        )],
        Some(&payer.pubkey()),
        &[&payer],
        recent_blockhash,
    );

    banks_client.process_transaction(fund_sender_tx).await.unwrap();

    // Try to schedule transfer too far in the future (> 30 days)
    let clock = banks_client.get_sysvar::<Clock>().await.unwrap();
    let execute_after = clock.unix_timestamp + (31 * 24 * 60 * 60); // 31 days

    let schedule_tx = create_schedule_transfer_tx(
        &sender,
        &recipient,
        [1u8; 32],
        500_000_000,
        execute_after,
        "Too far future".to_string(),
        &payer,
        recent_blockhash,
    );

    let result = banks_client.process_transaction(schedule_tx).await;
    assert!(result.is_err(), "Should fail when execution time is too far");

    if let Err(BanksClientError::TransactionError(TransactionError::InstructionError(
        _,
        InstructionError::Custom(error_code),
    ))) = result
    {
        assert_eq!(error_code, TransferError::ExecutionTimeTooFar as u32);
    }
}

// Helper function to create schedule transfer transaction
fn create_schedule_transfer_tx(
    sender: &Keypair,
    recipient: &Keypair,
    nonce: [u8; 32],
    amount: u64,
    execute_after: i64,
    memo: String,
    payer: &Keypair,
    recent_blockhash: solana_sdk::hash::Hash,
) -> Transaction {
    let (transfer_account, _bump) = Pubkey::find_program_address(
        &[b"transfer", sender.pubkey().as_ref(), nonce.as_ref()],
        &scheduled_transfer::id(),
    );

    let schedule_ix = anchor_lang::InstructionData::data(
        &scheduled_transfer::instruction::ScheduleTransfer {
            amount,
            execute_after,
            nonce,
            memo,
        }
    );

    let accounts = scheduled_transfer::accounts::ScheduleTransfer {
        transfer_account,
        sender: sender.pubkey(),
        recipient: recipient.pubkey(),
        token_mint: solana_program::system_program::id(),
        sender_token_account: None,
        escrow_token_account: None,
        token_program: None,
        system_program: solana_program::system_program::id(),
        rent: solana_program::sysvar::rent::id(),
    };

    Transaction::new_signed_with_payer(
        &[Instruction {
            program_id: scheduled_transfer::id(),
            accounts: anchor_lang::ToAccountMetas::to_account_metas(&accounts, None),
            data: schedule_ix,
        }],
        Some(&payer.pubkey()),
        &[payer, sender],
        recent_blockhash,
    )
}