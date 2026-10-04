//! LUMA Transfer Hook — Token-2022 her `transfer_checked` çağrısında bu programı çağırır.
//! Kaynak ve hedef token hesaplarının sahiplerinin `luma_batch::KycRegistry` kaydı
//! `is_approved == true` olmadıkça transfer reddedilir.
//!
//! Ekstra hesaplar (ExtraAccountMetaList, Execute talimat indeksleri):
//!   0 source_token, 1 mint, 2 destination_token, 3 owner, 4 extra_account_meta_list,
//!   5 luma_batch programı (sabit adres),
//!   6 source KYC PDA   = PDA(luma_batch, ["kyc", source_token.data[32..64]]),
//!   7 dest KYC PDA     = PDA(luma_batch, ["kyc", destination_token.data[32..64]]).
//! Token hesabında sahip (owner) alanı 32. bayttan başlar (mint 0..32, owner 32..64).

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

pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

const TOKEN_ACCOUNT_OWNER_OFFSET: u8 = 32;
const PUBKEY_LEN: u8 = 32;
const SOURCE_TOKEN_INDEX: u8 = 0;
const DESTINATION_TOKEN_INDEX: u8 = 2;
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

    /// `spl_transfer_hook_interface::InitializeExtraAccountMetaList` ayırıcısıyla çağrılır.
    #[interface(spl_transfer_hook_interface::initialize_extra_account_meta_list)]
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let metas = extra_account_metas()?;
        let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
        Ok(())
    }

    /// `spl_transfer_hook_interface::Execute` ayırıcısıyla Token-2022 tarafından çağrılır.
    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        assert_is_transferring(&ctx.accounts.source_token.to_account_info())?;
        require!(
            ctx.accounts.source_kyc.is_approved,
            HookError::SourceNotKycApproved
        );
        require!(
            ctx.accounts.destination_kyc.is_approved,
            HookError::DestinationNotKycApproved
        );
        Ok(())
    }
}

pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
    Ok(vec![
        ExtraAccountMeta::new_with_pubkey(&luma_batch::ID, false, false)?,
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

/// Doğrudan (Token-2022 dışından) çağrılarak KYC kontrolünün "taklit" edilmesini engeller.
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

    /// CHECK: TLV formatında (Anchor discriminator'sız) bir hesaptır; bu nedenle tipli
    /// `Account<T>` kullanılamaz. Adres seeds+bump ile kilitlenir, boyut ExtraAccountMetaList
    /// tarafından hesaplanır ve içerik `ExtraAccountMetaList::init` ile yazılır.
    #[account(
        init,
        payer = payer,
        space = ExtraAccountMetaList::size_of(extra_account_metas()?.len())?,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    #[account(
        constraint = mint.to_account_info().owner == &anchor_spl::token_2022::ID
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

/// Hesap sırası `spl_transfer_hook_interface::Execute` sözleşmesine birebir uyar.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Kaynak hesabın sahibi veya delegesi olabilir; imza/yetki doğrulamasını
    /// Token-2022 hook'u çağırmadan önce zaten yapmıştır. Hook bu hesabı okumaz.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: TLV formatlı ExtraAccountMetaList; adresi seeds ile doğrulanır.
    #[account(seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub luma_batch_program: Program<'info, LumaBatch>,

    #[account(
        seeds = [KYC_SEED, source_token.owner.as_ref()],
        seeds::program = luma_batch_program.key(),
        bump = source_kyc.bump
    )]
    pub source_kyc: Account<'info, KycRegistry>,

    #[account(
        seeds = [KYC_SEED, destination_token.owner.as_ref()],
        seeds::program = luma_batch_program.key(),
        bump = destination_kyc.bump
    )]
    pub destination_kyc: Account<'info, KycRegistry>,
}
