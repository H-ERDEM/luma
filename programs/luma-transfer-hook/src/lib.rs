//! # LUMA Transfer Hook — Token-2022 KYC Enforcement for RWA Lettuce Batches
//!
//! ## Overview & Regulatory Context
//! LumaGrow tokenizes real-world agricultural assets (40-day hydroponic lettuce batches)
//! on Solana using the **Token-2022 (Extensions-Program)** standard. Because physical seedlings
//! represent regulated agricultural inventory under an on-chain collateral guarantee, token
//! transfers must comply with strict investor qualification (KYC/AML) rules.
//!
//! This program implements the `spl-transfer-hook-interface`. Every time a holder executes a
//! `transfer_checked` instruction on a LumaGrow seedling mint, the Token-2022 runtime programmatically
//! invokes this hook via Cross-Program Invocation (CPI). If either the sender or recipient wallet
//! is not explicitly approved in the on-chain `KycRegistry` of the core `luma_batch` protocol,
//! the transaction is unconditionally reverted at the Solana Virtual Machine (SVM) level.
//!
//! ## How ExtraAccountMetaList Dynamic Account Resolution Works
//! Token-2022 transfer hooks cannot predict arbitrary extra accounts ahead of time without
//! an on-chain directory. This hook establishes an `ExtraAccountMetaList` account (derived with
//! seeds `[b"extra-account-metas", mint_key]`) containing Type-Length-Value (TLV) account metadata.
//!
//! During transaction compilation, the SPL Transfer Hook client reads this list to automatically
//! inject the required auxiliary accounts into the `execute` instruction:
//!
//! | Index | Account | Resolution Method | Description |
//! |---|---|---|---|
//! | 0 | `source_token` | Standard CPI Account | Sender's Token-2022 account |
//! | 1 | `mint` | Standard CPI Account | Batch seedling mint address |
//! | 2 | `destination_token` | Standard CPI Account | Receiver's Token-2022 account |
//! | 3 | `owner` | Standard CPI Account | Authority signing the transfer |
//! | 4 | `extra_account_meta_list` | PDA `[b"extra-account-metas", mint]` | This hook's TLV metadata entry |
//! | 5 | `luma_batch_program` | Static Pubkey | Address of the core `luma_batch` program (`A7d9dA7v...`) |
//! | 6 | `source_kyc` | External PDA Resolution | `PDA(luma_batch, [b"kyc", source_token.data[32..64]])` |
//! | 7 | `destination_kyc` | External PDA Resolution | `PDA(luma_batch, [b"kyc", dest_token.data[32..64]])` |
//!
//! ## Parsing SPL Token Account Byte Offsets (`[32..64]`)
//! Standard SPL Token and Token-2022 accounts adhere to a deterministic binary layout:
//! - Bytes `0..32`: Mint public key
//! - Bytes `32..64`: **Owner wallet public key** (the physical owner of the tokens)
//! - Bytes `64..72`: Amount (`u64` little-endian)
//!
//! By specifying `Seed::AccountData { account_index, data_index: 32, length: 32 }`, the runtime extracts
//! the 32-byte wallet public key directly from the token account bytes at runtime without requiring
//! redundant RPC queries or client-side trust.
//!
//! ## Security Guarantee & Anti-Spoofing
//! 1. **Unconditional Reversion:** If `source_kyc.is_approved == false` or `destination_kyc.is_approved == false`,
//!    execution halts immediately with `HookError::SourceNotKycApproved` or `HookError::DestinationNotKycApproved`.
//! 2. **Anti-Spoofing Guard (`assert_is_transferring`):** To prevent an attacker from calling the hook
//!    out of context (e.g. attempting to fake a success log), the hook unpacks the `TransferHookAccount`
//!    extension on the source account and verifies that `transferring == true`. Token-2022 sets this flag
//!    exclusively during active transfer CPI execution and resets it immediately afterwards.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions},
    state::Account as SplTokenAccount,
};
use anchor_spl::token_interface::{Mint, TokenAccount};
use luma_batch::constants::KYC_SEED;
use luma_batch::program::LumaBatch;
use luma_batch::state::KycRegistry;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("H1vq1NJ4wm4WwPchrChCf4a2MbDABdNya2rusQ7qtj4z");

/// PDA seed for the TLV `ExtraAccountMetaList` account.
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

/// Offset of the `owner` field in an SPL Token account data slice (bytes 32..64).
const TOKEN_ACCOUNT_OWNER_OFFSET: u8 = 32;

/// Length of a standard Solana 32-byte public key.
const PUBKEY_LEN: u8 = 32;

/// Instruction account index of `source_token` in the execute instruction interface.
const SOURCE_TOKEN_INDEX: u8 = 0;

/// Instruction account index of `destination_token` in the execute instruction interface.
const DESTINATION_TOKEN_INDEX: u8 = 2;

/// Instruction account index of `luma_batch_program` in the execute instruction interface.
const LUMA_BATCH_PROGRAM_INDEX: u8 = 5;

#[error_code]
pub enum HookError {
    #[msg("Gönderen cüzdan KYC onaylı değil")]
    SourceNotKycApproved,
    #[msg("Alıcı cüzdan KYC onaylı değil")]
    DestinationNotKycApproved,
    #[msg("Hook yalnızca Token-2022 transferi sırasında çağrılabilir")]
    NotTransferring,
}

#[program]
pub mod luma_transfer_hook {
    use super::*;

    /// Initializes the `ExtraAccountMetaList` for a newly deployed LumaGrow seedling mint.
    ///
    /// Invoked with the `spl_transfer_hook_interface::InitializeExtraAccountMetaList` instruction
    /// discriminator. Writes the external PDA resolution rules into the TLV account.
    #[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let metas = extra_account_metas()?;
        let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
        Ok(())
    }

    /// Primary transfer gate invoked by Token-2022 runtime on every `transfer_checked`.
    ///
    /// Verifies that:
    /// 1. The invocation originates from an authentic active Token-2022 transfer (`transferring == true`).
    /// 2. The source wallet holds an active `KycRegistry` entry with `is_approved == true`.
    /// 3. The destination wallet holds an active `KycRegistry` entry with `is_approved == true`.
    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        // Enforce that this instruction is called strictly inside an SPL Token-2022 transfer execution
        assert_is_transferring(&ctx.accounts.source_token.to_account_info())?;

        // Enforce KYC compliance for the sender
        require!(
            ctx.accounts.source_kyc.is_approved,
            HookError::SourceNotKycApproved
        );

        // Enforce KYC compliance for the recipient
        require!(
            ctx.accounts.destination_kyc.is_approved,
            HookError::DestinationNotKycApproved
        );

        Ok(())
    }
}

/// Defines the dynamic account resolution entries stored in `ExtraAccountMetaList`.
///
/// Configures 3 additional accounts required by `transfer_hook`:
/// 1. `luma_batch` program pubkey (needed as external program owner for PDA derivation).
/// 2. Source KYC PDA: derived from `[b"kyc", source_token.owner]`.
/// 3. Destination KYC PDA: derived from `[b"kyc", destination_token.owner]`.
pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
    Ok(vec![
        // Index 5: The LumaBatch program ID
        ExtraAccountMeta::new_with_pubkey(&luma_batch::ID, false, false)?,

        // Index 6: Source KYC PDA derived using source token's owner bytes [32..64]
        ExtraAccountMeta::new_external_pda_with_seeds(
            LUMA_BATCH_PROGRAM_INDEX,
            &[
                Seed::Literal {
                    bytes: KYC_SEED.to_vec(),
                },
                Seed::AccountData {
                    account_index: SOURCE_TOKEN_INDEX,
                    data_index: TOKEN_ACCOUNT_OWNER_OFFSET,
                    length: PUBKEY_LEN,
                },
            ],
            false,
            false,
        )?,

        // Index 7: Destination KYC PDA derived using destination token's owner bytes [32..64]
        ExtraAccountMeta::new_external_pda_with_seeds(
            LUMA_BATCH_PROGRAM_INDEX,
            &[
                Seed::Literal {
                    bytes: KYC_SEED.to_vec(),
                },
                Seed::AccountData {
                    account_index: DESTINATION_TOKEN_INDEX,
                    data_index: TOKEN_ACCOUNT_OWNER_OFFSET,
                    length: PUBKEY_LEN,
                },
            ],
            false,
            false,
        )?,
    ])
}

/// Prevents spoofed executions by asserting that Token-2022 is currently executing a transfer.
///
/// Unpacks the `TransferHookAccount` extension from the source account. The `transferring` flag
/// is a transient boolean maintained by Token-2022 that is only `true` during the CPI call.
fn assert_is_transferring(source_token: &AccountInfo) -> Result<()> {
    let data = source_token.try_borrow_data()?;
    let account = StateWithExtensions::<SplTokenAccount>::unpack(&data)?;
    let extension = account.get_extension::<TransferHookAccount>()?;
    require!(
        bool::from(extension.transferring),
        HookError::NotTransferring
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: TLV formatted ExtraAccountMetaList account (no Anchor 8-byte discriminator).
    /// Address is strictly verified by seeds `[b"extra-account-metas", mint.key()]` and bump.
    /// Space is dynamically computed based on `extra_account_metas().len()`.
    #[account(
        init,
        payer = payer,
        space = ExtraAccountMetaList::size_of(extra_account_metas()?.len())?,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// The Token-2022 mint for which the transfer hook is being configured.
    #[account(
        constraint = mint.to_account_info().owner == &anchor_spl::token_2022::ID
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

/// Account validation context matching the `spl_transfer_hook_interface::Execute` specification.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// The source token account sending the seedlings.
    #[account(token::mint = mint)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    /// The seedling Token-2022 mint.
    pub mint: InterfaceAccount<'info, Mint>,

    /// The recipient token account receiving the seedlings.
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Owner or authorized delegate of the source token account.
    /// Authority verification is performed by Token-2022 prior to invoking this hook.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: TLV ExtraAccountMetaList account, address verified by seeds.
    #[account(seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// The LumaBatch program owning the KycRegistry accounts.
    pub luma_batch_program: Program<'info, LumaBatch>,

    /// The KYC record of the sending wallet in the core protocol.
    #[account(
        seeds = [KYC_SEED, source_token.owner.as_ref()],
        seeds::program = luma_batch_program.key(),
        bump = source_kyc.bump
    )]
    pub source_kyc: Account<'info, KycRegistry>,

    /// The KYC record of the receiving wallet in the core protocol.
    #[account(
        seeds = [KYC_SEED, destination_token.owner.as_ref()],
        seeds::program = luma_batch_program.key(),
        bump = destination_kyc.bump
    )]
    pub destination_kyc: Account<'info, KycRegistry>,
}
