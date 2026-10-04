//! Tekrarlanan token CPI desenleri.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, transfer_checked, Burn, TransferChecked};

/// PDA otoritesine sahip bir USDC hesabından ödeme yapar. Sıfır tutarda CPI atlanır.
#[allow(clippy::too_many_arguments)]
pub fn pay_from_pda<'info>(
    token_program: AccountInfo<'info>,
    from: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from,
                mint,
                to,
                authority,
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}

/// Sahibinin imzasıyla Token-2022 varlık token'ı yakar. Yakım transfer hook'u tetiklemez.
pub fn burn_from_holder<'info>(
    token_program: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    from: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    burn(
        CpiContext::new(
            token_program,
            Burn {
                mint,
                from,
                authority,
            },
        ),
        amount,
    )
}
