//! WIELER — NEP-141 fungible token with NEP-148 metadata.
//!
//! * Fixed supply of 1,000,000,000 WIELER minted once in `new`. There is no mint method.
//! * Allocation: 70% community (held by this contract and given out by `faucet`),
//!   20% raid rewards pool, 10% team.
//! * `burn` lets any holder destroy their own tokens. The raid contract uses it to burn
//!   conquest stakes, so supply only falls through game rules.

use near_contract_standards::fungible_token::events::FtBurn;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LazyOption;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

pub const DECIMALS: u8 = 18;
pub const ONE_WIELER: u128 = 1_000_000_000_000_000_000;
pub const TOTAL_SUPPLY: u128 = 1_000_000_000 * ONE_WIELER;
/// Amount handed out per faucet claim on testnet.
pub const FAUCET_AMOUNT: u128 = 25_000 * ONE_WIELER;
/// Minimum time between faucet claims for one account (12 hours).
pub const FAUCET_COOLDOWN_NS: u64 = 12 * 60 * 60 * 1_000_000_000;

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230b1838'/%3E%3Cpath d='M8 16h10l6 22 8-22 8 22 6-22h10L44 50h-8l-4-12-4 12h-8z' fill='%23d6e2ff'/%3E%3C/svg%3E";

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    FungibleToken,
    Metadata,
    FaucetClaims,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    faucet_claims: LookupMap<AccountId, u64>,
    total_burned: u128,
}

#[near]
impl Contract {
    /// Mints the whole supply once: 70% to this contract (faucet / airdrop),
    /// 20% to the raid rewards pool, 10% to the team account.
    #[init]
    pub fn new(rewards_pool: AccountId, team: AccountId) -> Self {
        let mut this = Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(
                StorageKey::Metadata,
                Some(&FungibleTokenMetadata {
                    spec: FT_METADATA_SPEC.to_string(),
                    name: "WIELER".to_string(),
                    symbol: "WIELER".to_string(),
                    icon: Some(ICON.to_string()),
                    reference: None,
                    reference_hash: None,
                    decimals: DECIMALS,
                }),
            ),
            faucet_claims: LookupMap::new(StorageKey::FaucetClaims),
            total_burned: 0,
        };
        let me = env::current_account_id();
        let community = TOTAL_SUPPLY * 70 / 100;
        let rewards = TOTAL_SUPPLY * 20 / 100;
        let team_amount = TOTAL_SUPPLY - community - rewards;
        for acc in [&me, &rewards_pool, &team] {
            if !this.token.accounts.contains_key(acc) {
                this.token.internal_register_account(acc);
            }
        }
        this.token.internal_deposit(&me, community);
        this.token.internal_deposit(&rewards_pool, rewards);
        this.token.internal_deposit(&team, team_amount);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &me,
            amount: U128(community),
            memo: Some("community allocation (faucet)"),
        }
        .emit();
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &rewards_pool,
            amount: U128(rewards),
            memo: Some("raid rewards pool"),
        }
        .emit();
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &team,
            amount: U128(team_amount),
            memo: Some("team and development"),
        }
        .emit();
        this
    }

    /// Burns `amount` of the caller's own WIELER. Requires 1 yoctoNEAR.
    #[payable]
    pub fn burn(&mut self, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        let owner = env::predecessor_account_id();
        require!(amount.0 > 0, "amount must be positive");
        self.token.internal_withdraw(&owner, amount.0);
        self.total_burned += amount.0;
        FtBurn { owner_id: &owner, amount, memo: memo.as_deref() }.emit();
        log!("Burned {} WIELER from {}", amount.0 / ONE_WIELER, owner);
    }

    /// Testnet faucet: sends FAUCET_AMOUNT from the community allocation.
    /// Registers the caller if needed (attach the storage deposit, 0.00125 NEAR).
    #[payable]
    pub fn faucet(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        let now = env::block_timestamp();
        if let Some(last) = self.faucet_claims.get(&account) {
            require!(now >= last + FAUCET_COOLDOWN_NS, "faucet cooldown: try again later");
        }
        if !self.token.accounts.contains_key(&account) {
            let min = self.token.storage_balance_bounds().min;
            require!(
                env::attached_deposit() >= min,
                format!("attach {} yoctoNEAR to register", min.as_yoctonear())
            );
            self.token.internal_register_account(&account);
        }
        let me = env::current_account_id();
        let available = self.token.internal_unwrap_balance_of(&me);
        let amount = FAUCET_AMOUNT.min(available);
        require!(amount > 0, "faucet is empty");
        self.token.internal_transfer(&me, &account, amount, Some("faucet".into()));
        self.faucet_claims.insert(&account, &now);
        U128(amount)
    }

    pub fn faucet_next_claim(&self, account_id: AccountId) -> u64 {
        self.faucet_claims.get(&account_id).map(|t| t + FAUCET_COOLDOWN_NS).unwrap_or(0)
    }

    pub fn total_burned(&self) -> U128 {
        U128(self.total_burned)
    }

    pub fn initial_supply(&self) -> U128 {
        U128(TOTAL_SUPPLY)
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            self.total_burned += burned;
            log!("Account @{} burned {}", sender_id, burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        #[allow(unused_variables)]
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            self.total_burned += balance;
            log!("Closed @{} with {}", account_id, balance);
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}
