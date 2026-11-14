//! WIELER raid game contract.
//!
//! Raiders stake WIELER behind a target chain with `ft_transfer_call`. When an epoch ends a
//! keeper calls `close_epoch`: the most-staked chain is raided, burns and the raid fee are
//! applied, the territory changes hands and a flag is created. The broadcaster then calls
//! `request_flag_signature` with foreign-chain parameters (nonce / UTXO / blockhash); the
//! contract builds the flag transaction itself, checks it against guardrails and asks the
//! NEAR MPC network (Chain Signatures) to sign it. `confirm_broadcast` records the foreign
//! tx hash, which must match the hash the contract computed for the signed transaction.

mod tx;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{
    env, ext_contract, log, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub const BPS: u128 = 10_000;
pub const MAX_STAKERS_PER_CHAIN: usize = 64;
pub const MAX_HOLDERS: usize = 64;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_BURN: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_MPC_SIGN: Gas = Gas::from_tgas(50);
const GAS_ON_SIGNATURE: Gas = Gas::from_tgas(30);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// A flag left in `Signing` this long may be re-requested. MPC sign requests time out
/// after a few minutes, so by then the original request can no longer complete; this is
/// the escape hatch for a callback that never landed its result (e.g. ran out of gas).
pub const SIGNING_TIMEOUT_MS: u64 = 30 * 60 * 1000;

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait Token {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn burn(&mut self, amount: U128, memo: Option<String>);
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Chains,
    Territories,
    Epochs,
    Stakers,
    AccountStakes,
    Flags,
    Rewards,
    Pending,
    Raiders,
    Clans,
    Activity,
    Supply,
}

// ======================================================================== types

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ChainKind {
    Evm,
    Bitcoin,
    Solana,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Chain {
    pub id: String,
    pub name: String,
    pub kind: ChainKind,
    /// Chain Signatures derivation path, e.g. "wieler/btc".
    pub path: String,
    /// Derived public key (hex): compressed secp256k1 (BTC, EVM) or ed25519 (Solana).
    pub derived_pubkey: String,
    /// Human-readable address of the WIELER wallet on that chain.
    pub derived_address: String,
    pub evm_chain_id: Option<u64>,
    /// "tb" for Bitcoin testnet; unused otherwise.
    pub btc_hrp: Option<String>,
    /// Explorer prefix; the tx hash is appended.
    pub explorer_tx_url: String,
    /// Max memo bytes carried by the flag transaction.
    pub payload_limit: u32,
    /// Fee cap in the chain's smallest unit (wei / sats / lamports).
    pub max_fee: U128,
    /// WIELER set aside from raid fees to cover foreign gas.
    pub gas_reserve: U128,
    pub conquest_count: u32,
    /// Displayed raid target for an unheld chain (WIELER, 18 decimals).
    pub min_target: U128,
    pub territory_account: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Holder {
    pub account_id: AccountId,
    pub stake: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Territory {
    pub chain: String,
    pub holders: Vec<Holder>,
    pub total_stake: U128,
    pub held_since_epoch: u64,
    pub barbarian: bool,
    pub clan: Option<String>,
    /// Barbarian stake withheld while it holds this chain; paid to whoever retakes it.
    pub bounty_escrow: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum OutcomeKind {
    Empty,
    Conquered,
    Reconquered,
    Defended,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Outcome {
    pub kind: OutcomeKind,
    pub chain: Option<String>,
    pub burn_bps: u16,
    /// Accounts whose stake on `chain` is burned at `burn_bps` (the winning side).
    pub winners: Vec<AccountId>,
    pub winning_stake: U128,
    pub defending_stake: U128,
    pub burned: U128,
    pub fee_total: U128,
    pub barbarian_won: bool,
    pub barbarian_escrow_bps: u16,
    pub flag_id: Option<u64>,
    pub keeper: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct ChainStake {
    pub chain: String,
    pub amount: U128,
    pub stakers: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Epoch {
    pub id: u64,
    pub start_ns: U64,
    pub end_ns: U64,
    pub chain_stakes: Vec<ChainStake>,
    pub total: U128,
    pub closed: bool,
    pub outcome: Option<Outcome>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct StakeEntry {
    pub account_id: AccountId,
    pub amount: U128,
    pub settled: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum FlagStatus {
    AwaitingTx,
    Signing,
    Signed,
    Broadcast,
    Failed,
}

#[near(serializers = [json])]
#[serde(tag = "kind")]
pub enum TxParams {
    Evm {
        nonce: u64,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
        gas_limit: u64,
    },
    Bitcoin {
        /// Display-order txid of the UTXO being spent (owned by the WIELER wallet).
        txid: String,
        vout: u32,
        value: U64,
        fee: U64,
    },
    Solana {
        recent_blockhash: String,
    },
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Flag {
    pub id: u64,
    pub chain: String,
    pub epoch: u64,
    pub names: Vec<AccountId>,
    pub memo: String,
    pub barbarian: bool,
    pub status: FlagStatus,
    /// Serialized params the transaction was built from (JSON).
    pub tx_params: Option<String>,
    pub unsigned_tx: Option<String>,
    pub payload: Option<String>,
    pub signed_tx: Option<String>,
    pub expected_tx_hash: Option<String>,
    pub tx_hash: Option<String>,
    pub explorer_url: Option<String>,
    pub created_ms: U64,
    pub error: Option<String>,
}

/// Bookkeeping for a flag's latest MPC sign request. Kept in its own raw storage slot,
/// outside `Flag` and `Contract`, so adding it did not change the stored state layout.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct SignRequest {
    /// Increments on every request; only the callback carrying the latest id is applied.
    pub request_id: u64,
    pub started_ms: U64,
}

#[near(serializers = [json])]
pub struct SignRequestView {
    pub request_id: u64,
    pub started_ms: U64,
    /// When a flag still in `Signing` may be re-requested.
    pub retry_after_ms: U64,
}

fn sign_request_key(flag_id: u64) -> Vec<u8> {
    [b"sigreq".as_slice(), &flag_id.to_le_bytes()].concat()
}

fn read_sign_request(flag_id: u64) -> Option<SignRequest> {
    env::storage_read(&sign_request_key(flag_id)).and_then(|b| near_sdk::borsh::from_slice(&b).ok())
}

fn write_sign_request(flag_id: u64, r: &SignRequest) {
    env::storage_write(&sign_request_key(flag_id), &near_sdk::borsh::to_vec(r).unwrap());
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Raider {
    pub total_staked: U128,
    pub active_stake: U128,
    pub burned: U128,
    pub conquests: u32,
    pub clan: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Clan {
    pub name: String,
    pub members: u32,
    pub total_staked: U128,
    pub conquests: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Activity {
    pub kind: String,
    pub text: String,
    pub chain: Option<String>,
    pub flag_id: Option<u64>,
    pub ts_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct SupplyPoint {
    pub epoch: u64,
    pub ts_ms: U64,
    pub burned_total: U128,
    pub chain: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    pub token: AccountId,
    pub mpc_contract: AccountId,
    pub epoch_length_ms: U64,
    pub first_burn_bps: u16,
    pub reconquest_burn_bps: u16,
    /// Total raid fee (200 = 2%) and its split; the three parts must add up to it.
    pub fee_bps: u16,
    pub fee_holders_bps: u16,
    pub fee_gas_bps: u16,
    pub fee_keeper_bps: u16,
    pub barbarian: Option<AccountId>,
    /// Barbarian may stake at most this share of the other raiders' epoch stake...
    pub barbarian_epoch_share_bps: u16,
    /// ...or this floor, whichever is larger.
    pub barbarian_floor: U128,
    pub reclaim_bounty_bps: u16,
    pub barbarian_attestation_url: Option<String>,
    pub create_territory_accounts: bool,
}

#[near(serializers = [json])]
pub struct MapChain {
    pub chain: Chain,
    pub territory: Option<Territory>,
    pub epoch_stake: U128,
    pub epoch_stakers: u32,
    pub target: U128,
}

#[near(serializers = [json])]
pub struct MapView {
    pub epoch: Epoch,
    pub now_ms: U64,
    pub chains: Vec<MapChain>,
    pub total_burned: U128,
    pub flags: u64,
    pub clans: u32,
    pub barbarian: Option<AccountId>,
    pub barbarian_attestation_url: Option<String>,
}

#[near(serializers = [json])]
pub struct AccountStakeView {
    pub epoch: u64,
    pub chain: String,
    pub amount: U128,
    pub settled: bool,
    pub claimable: Option<U128>,
}

// ======================================================================== state

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    config: Config,
    chain_ids: Vec<String>,
    chains: LookupMap<String, Chain>,
    territories: LookupMap<String, Territory>,
    current: Epoch,
    epochs: LookupMap<u64, Epoch>,
    stakers: LookupMap<(u64, String), Vec<StakeEntry>>,
    account_stakes: LookupMap<AccountId, Vec<(u64, String)>>,
    flags: Vector<Flag>,
    rewards: LookupMap<(String, AccountId), u128>,
    pending: LookupMap<AccountId, u128>,
    raiders: IterableMap<AccountId, Raider>,
    clans: IterableMap<String, Clan>,
    activity: Vector<Activity>,
    supply: Vector<SupplyPoint>,
    total_burned: u128,
}

fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "wieler", "version": "1.0.0", "event": event, "data": [data]})
    ));
}

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    use primitive_types::U256;
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
}

fn bps(amount: u128, b: u16) -> u128 {
    amount * b as u128 / BPS
}

fn whole(amount: u128) -> String {
    let w = amount / 1_000_000_000_000_000_000;
    if w >= 1_000_000 {
        format!("{}.{}M", w / 1_000_000, (w % 1_000_000) / 100_000)
    } else if w >= 1_000 {
        format!("{}.{}K", w / 1_000, (w % 1_000) / 100)
    } else {
        w.to_string()
    }
}

fn parse_hex32(s: &str) -> [u8; 32] {
    let v = hex::decode(s.trim_start_matches("0x")).expect("bad hex");
    v.try_into().expect("expected 32 bytes")
}

fn valid_clan_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 24
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, token: AccountId, mpc_contract: AccountId, epoch_length_ms: U64) -> Self {
        let now = env::block_timestamp();
        let mut this = Self {
            owner,
            config: Config {
                token,
                mpc_contract,
                epoch_length_ms,
                first_burn_bps: 1000,
                reconquest_burn_bps: 500,
                fee_bps: 200,
                fee_holders_bps: 100,
                fee_gas_bps: 50,
                fee_keeper_bps: 50,
                barbarian: None,
                barbarian_epoch_share_bps: 4000,
                barbarian_floor: U128(250_000 * 1_000_000_000_000_000_000),
                reclaim_bounty_bps: 1000,
                barbarian_attestation_url: None,
                create_territory_accounts: true,
            },
            chain_ids: vec![],
            chains: LookupMap::new(Key::Chains),
            territories: LookupMap::new(Key::Territories),
            current: Epoch {
                id: 1,
                start_ns: U64(now),
                end_ns: U64(now + epoch_length_ms.0 * 1_000_000),
                chain_stakes: vec![],
                total: U128(0),
                closed: false,
                outcome: None,
            },
            epochs: LookupMap::new(Key::Epochs),
            stakers: LookupMap::new(Key::Stakers),
            account_stakes: LookupMap::new(Key::AccountStakes),
            flags: Vector::new(Key::Flags),
            rewards: LookupMap::new(Key::Rewards),
            pending: LookupMap::new(Key::Pending),
            raiders: IterableMap::new(Key::Raiders),
            clans: IterableMap::new(Key::Clans),
            activity: Vector::new(Key::Activity),
            supply: Vector::new(Key::Supply),
            total_burned: 0,
        };
        this.supply.push(SupplyPoint {
            epoch: 0,
            ts_ms: U64(env::block_timestamp_ms()),
            burned_total: U128(0),
            chain: None,
        });
        this
    }

    // ------------------------------------------------------------ owner

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_chain(
        &mut self,
        id: String,
        name: String,
        kind: ChainKind,
        path: String,
        derived_pubkey: String,
        derived_address: String,
        evm_chain_id: Option<u64>,
        btc_hrp: Option<String>,
        explorer_tx_url: String,
        payload_limit: u32,
        max_fee: U128,
        min_target: U128,
    ) {
        self.assert_owner();
        let pk = hex::decode(derived_pubkey.trim_start_matches("0x")).expect("pubkey hex");
        match kind {
            ChainKind::Evm => {
                require!(pk.len() == 33 || pk.len() == 65, "secp256k1 pubkey expected");
                require!(evm_chain_id.is_some(), "evm_chain_id required");
            }
            ChainKind::Bitcoin => {
                require!(pk.len() == 33, "compressed secp256k1 pubkey expected");
                let hrp = btc_hrp.clone().expect("btc_hrp required");
                let pkh = tx::hash160(&pk);
                require!(
                    tx::p2wpkh_address(&hrp, &pkh) == derived_address,
                    "derived_address does not match pubkey"
                );
            }
            ChainKind::Solana => {
                require!(pk.len() == 32, "ed25519 pubkey expected");
                require!(
                    bs58::encode(&pk).into_string() == derived_address,
                    "derived_address does not match pubkey"
                );
            }
        }
        let existing = self.chains.get(&id).cloned();
        let chain = Chain {
            id: id.clone(),
            name,
            kind,
            path,
            derived_pubkey,
            derived_address,
            evm_chain_id,
            btc_hrp,
            explorer_tx_url,
            payload_limit: payload_limit.min(80),
            max_fee,
            gas_reserve: existing.as_ref().map(|c| c.gas_reserve).unwrap_or(U128(0)),
            conquest_count: existing.as_ref().map(|c| c.conquest_count).unwrap_or(0),
            min_target,
            territory_account: existing.and_then(|c| c.territory_account),
        };
        if !self.chain_ids.contains(&id) {
            self.chain_ids.push(id.clone());
        }
        self.chains.insert(id, chain);
    }

    pub fn set_config(&mut self, config: Config) {
        self.assert_owner();
        require!(
            config.fee_holders_bps + config.fee_gas_bps + config.fee_keeper_bps == config.fee_bps,
            "fee split must add up to fee_bps"
        );
        require!(config.fee_bps as u128 + config.first_burn_bps as u128 <= BPS, "bps too high");
        require!(config.token == self.config.token, "token cannot change");
        self.config = config;
    }

    pub fn register_barbarian(&mut self, account: AccountId, attestation_url: Option<String>) {
        self.assert_owner();
        self.config.barbarian = Some(account);
        self.config.barbarian_attestation_url = attestation_url;
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        self.assert_owner();
        self.owner = owner;
    }

    // ------------------------------------------------------------ clans

    pub fn join_clan(&mut self, name: String) {
        require!(valid_clan_name(&name), "clan: 1-24 chars of a-z, 0-9, _ or -");
        let account = env::predecessor_account_id();
        let mut raider = self.raiders.get(&account).cloned().unwrap_or_default();
        if let Some(old) = raider.clan.take() {
            if let Some(c) = self.clans.get_mut(&old) {
                c.members = c.members.saturating_sub(1);
            }
        }
        let clan = self.clans.entry(name.clone()).or_insert(Clan {
            name: name.clone(),
            members: 0,
            total_staked: U128(0),
            conquests: 0,
        });
        clan.members += 1;
        raider.clan = Some(name.clone());
        self.raiders.insert(account.clone(), raider);
        self.log_activity("clan", format!("New clan member: {} joined {}", account, name), None, None);
    }

    // ------------------------------------------------------------ staking

    fn chain_stake_mut(&mut self, chain: &str) -> &mut ChainStake {
        if let Some(i) = self.current.chain_stakes.iter().position(|c| c.chain == chain) {
            &mut self.current.chain_stakes[i]
        } else {
            self.current.chain_stakes.push(ChainStake {
                chain: chain.to_string(),
                amount: U128(0),
                stakers: 0,
            });
            self.current.chain_stakes.last_mut().unwrap()
        }
    }

    /// Returns Err(reason) if the stake must be refunded.
    fn internal_stake(&mut self, sender: &AccountId, amount: u128, chain: &str) -> Result<(), String> {
        if !self.chains.contains_key(chain) {
            return Err(format!("unknown chain {}", chain));
        }
        if env::block_timestamp() >= self.current.end_ns.0 {
            return Err("epoch has ended; waiting for close_epoch".into());
        }
        let epoch = self.current.id;

        if self.config.barbarian.as_ref() == Some(sender) {
            // One target per epoch.
            for cs in &self.current.chain_stakes {
                if cs.chain != chain {
                    if let Some(list) = self.stakers.get(&(epoch, cs.chain.clone())) {
                        if list.iter().any(|e| &e.account_id == sender) {
                            return Err("barbarian already targets another chain".into());
                        }
                    }
                }
            }
            let mine: u128 = self
                .stakers
                .get(&(epoch, chain.to_string()))
                .and_then(|l| l.iter().find(|e| &e.account_id == sender).map(|e| e.amount.0))
                .unwrap_or(0);
            let others = self.current.total.0 - mine;
            let cap = bps(others, self.config.barbarian_epoch_share_bps).max(self.config.barbarian_floor.0);
            if mine + amount > cap {
                return Err(format!("barbarian stake cap is {}", cap));
            }
        }

        let key = (epoch, chain.to_string());
        let mut list = self.stakers.get(&key).cloned().unwrap_or_default();
        let new_staker = match list.iter_mut().find(|e| &e.account_id == sender) {
            Some(e) => {
                e.amount = U128(e.amount.0 + amount);
                false
            }
            None => {
                if list.len() >= MAX_STAKERS_PER_CHAIN {
                    return Err("too many raiders on this chain this epoch".into());
                }
                list.push(StakeEntry { account_id: sender.clone(), amount: U128(amount), settled: false });
                true
            }
        };
        self.stakers.insert(key, list);
        {
            let cs = self.chain_stake_mut(chain);
            cs.amount = U128(cs.amount.0 + amount);
            if new_staker {
                cs.stakers += 1;
            }
        }
        self.current.total = U128(self.current.total.0 + amount);
        if new_staker {
            let mut idx = self.account_stakes.get(sender).cloned().unwrap_or_default();
            idx.push((epoch, chain.to_string()));
            self.account_stakes.insert(sender.clone(), idx);
        }
        let mut raider = self.raiders.get(sender).cloned().unwrap_or_default();
        raider.total_staked = U128(raider.total_staked.0 + amount);
        raider.active_stake = U128(raider.active_stake.0 + amount);
        if let Some(clan) = raider.clan.clone() {
            if let Some(c) = self.clans.get_mut(&clan) {
                c.total_staked = U128(c.total_staked.0 + amount);
            }
        }
        self.raiders.insert(sender.clone(), raider);

        emit("Staked", json!({"account_id": sender, "chain": chain, "epoch": epoch, "amount": U128(amount)}));
        let chain_name = self.chains.get(chain).map(|c| c.name.clone()).unwrap_or_default();
        self.log_activity(
            "stake",
            format!("{} staked {} WIELER on {}", sender, whole(amount), chain_name),
            Some(chain.to_string()),
            None,
        );
        Ok(())
    }

    /// Withdraws a stake from a closed epoch: stake minus raid fee, minus the burn if the
    /// account was on the conquering side (and minus the reclaim escrow for the Barbarian).
    pub fn unstake(&mut self, epoch: u64, chain: String) -> Promise {
        let account = env::predecessor_account_id();
        let ep = self.epochs.get(&epoch).cloned().expect("epoch not closed yet");
        let key = (epoch, chain.clone());
        let mut list = self.stakers.get(&key).cloned().expect("no stakes");
        let entry = list.iter_mut().find(|e| e.account_id == account).expect("no stake for account");
        require!(!entry.settled, "already unstaked");
        entry.settled = true;
        let stake = entry.amount.0;
        self.stakers.insert(key, list);

        let payout = self.settlement(&ep, &chain, &account, stake);
        let mut raider = self.raiders.get(&account).cloned().unwrap_or_default();
        raider.active_stake = U128(raider.active_stake.0.saturating_sub(stake));
        self.raiders.insert(account.clone(), raider);

        self.pay(account, payout, "unstake")
    }

    fn settlement(&self, ep: &Epoch, chain: &str, account: &AccountId, stake: u128) -> u128 {
        let o = ep.outcome.as_ref().expect("no outcome");
        let mut out = stake - bps(stake, self.config.fee_bps);
        if o.chain.as_deref() == Some(chain) && o.winners.contains(account) && o.burn_bps > 0 {
            out -= bps(stake, o.burn_bps);
            if o.barbarian_won && self.config.barbarian.as_ref() == Some(account) {
                out -= bps(stake, o.barbarian_escrow_bps);
            }
        }
        out
    }

    fn pay(&mut self, account: AccountId, amount: u128, memo: &str) -> Promise {
        require!(amount > 0, "nothing to pay");
        ext_ft::ext(self.config.token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), U128(amount), Some(format!("WIELER {}", memo)))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_payout(account, U128(amount)),
            )
    }

    /// If a payout fails (e.g. the account is not registered on the token), it is kept as
    /// pending and can be retried with `claim_pending`.
    #[private]
    pub fn on_payout(
        &mut self,
        account: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_err() {
            let p = self.pending.get(&account).copied().unwrap_or(0);
            self.pending.insert(account, p + amount.0);
            false
        } else {
            true
        }
    }

    pub fn claim_pending(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        let amount = self.pending.remove(&account).unwrap_or(0);
        self.pay(account, amount, "pending payout")
    }

    pub fn claim_territory_rewards(&mut self, chain: String) -> Promise {
        let account = env::predecessor_account_id();
        let amount = self.rewards.remove(&(chain.clone(), account.clone())).unwrap_or(0);
        self.pay(account, amount, &format!("territory rewards {}", chain))
    }

    // ------------------------------------------------------------ epoch close

    /// Anyone may call this once the epoch has ended; the caller earns the keeper tip.
    pub fn close_epoch(&mut self) -> Option<u64> {
        let now = env::block_timestamp();
        require!(now >= self.current.end_ns.0, "epoch still running");
        let keeper = env::predecessor_account_id();
        let epoch_id = self.current.id;
        let total = self.current.total.0;

        let mut outcome = Outcome {
            kind: OutcomeKind::Empty,
            chain: None,
            burn_bps: 0,
            winners: vec![],
            winning_stake: U128(0),
            defending_stake: U128(0),
            burned: U128(0),
            fee_total: U128(bps(total, self.config.fee_bps)),
            barbarian_won: false,
            barbarian_escrow_bps: 0,
            flag_id: None,
            keeper: keeper.clone(),
        };

        // Most-staked chain is raided (ties: first staked).
        let target = self
            .current
            .chain_stakes
            .iter()
            .filter(|c| c.amount.0 > 0)
            .fold(None::<&ChainStake>, |best, c| match best {
                Some(b) if b.amount.0 >= c.amount.0 => Some(b),
                _ => Some(c),
            })
            .map(|c| c.chain.clone());

        if let Some(chain_id) = target {
            let list = self.stakers.get(&(epoch_id, chain_id.clone())).cloned().unwrap_or_default();
            let held = self.territories.get(&chain_id).cloned();
            let mut chain = self.chains.get(&chain_id).cloned().unwrap();

            // ---- raid fee split (from all stake this epoch)
            let fee_holders = bps(total, self.config.fee_holders_bps);
            let fee_keeper = bps(total, self.config.fee_keeper_bps);
            let fee_gas = outcome.fee_total.0 - fee_holders - fee_keeper;
            chain.gas_reserve = U128(chain.gas_reserve.0 + fee_gas);
            if let Some(t) = &held {
                self.credit_holders(&chain_id, t, fee_holders);
            } else {
                chain.gas_reserve = U128(chain.gas_reserve.0 + fee_holders);
            }
            let p = self.pending.get(&keeper).copied().unwrap_or(0);
            self.pending.insert(keeper.clone(), p + fee_keeper);

            // ---- resolve the raid
            let (defenders, challengers): (Vec<&StakeEntry>, Vec<&StakeEntry>) = match &held {
                Some(t) => list
                    .iter()
                    .partition(|e| t.holders.iter().any(|h| h.account_id == e.account_id)),
                None => (vec![], list.iter().collect()),
            };
            let def_stake: u128 = defenders.iter().map(|e| e.amount.0).sum();
            let ch_stake: u128 = challengers.iter().map(|e| e.amount.0).sum();
            outcome.chain = Some(chain_id.clone());
            outcome.defending_stake = U128(def_stake);
            outcome.winning_stake = U128(ch_stake);

            let conquered = ch_stake > 0 && (held.is_none() || ch_stake > def_stake);
            if !conquered {
                outcome.kind = OutcomeKind::Defended;
                emit("Defended", json!({"epoch": epoch_id, "chain": chain_id, "defending": U128(def_stake), "challenging": U128(ch_stake)}));
                self.log_activity("defend", format!("{} defended its territory", chain.name), Some(chain_id.clone()), None);
            } else {
                let first = held.is_none() && chain.conquest_count == 0;
                let burn_bps = if held.is_none() { self.config.first_burn_bps } else { self.config.reconquest_burn_bps };
                outcome.kind = if held.is_none() { OutcomeKind::Conquered } else { OutcomeKind::Reconquered };
                outcome.burn_bps = burn_bps;
                let mut winners: Vec<StakeEntry> = challengers.into_iter().cloned().collect();
                winners.sort_by(|a, b| b.amount.0.cmp(&a.amount.0));
                outcome.winners = winners.iter().map(|e| e.account_id.clone()).collect();
                let burned = bps(ch_stake, burn_bps);
                outcome.burned = U128(burned);

                let barbarian = self.config.barbarian.clone();
                let barb_top = barbarian.is_some() && winners.first().map(|w| &w.account_id) == barbarian.as_ref();
                let barb_stake: u128 = winners
                    .iter()
                    .filter(|w| Some(&w.account_id) == barbarian.as_ref())
                    .map(|w| w.amount.0)
                    .sum();
                outcome.barbarian_won = barb_stake > 0;
                let escrow = if barb_stake > 0 {
                    outcome.barbarian_escrow_bps = self.config.reclaim_bounty_bps;
                    bps(barb_stake, self.config.reclaim_bounty_bps)
                } else {
                    0
                };

                // Reclaim bounty: players retaking a Barbarian territory share its escrow.
                let new_holders: Vec<Holder> = winners
                    .iter()
                    .take(MAX_HOLDERS)
                    .map(|w| Holder { account_id: w.account_id.clone(), stake: w.amount })
                    .collect();
                let new_territory = Territory {
                    chain: chain_id.clone(),
                    holders: new_holders,
                    total_stake: U128(ch_stake),
                    held_since_epoch: epoch_id,
                    barbarian: barb_top,
                    clan: self.dominant_clan(&winners),
                    bounty_escrow: U128(escrow),
                };
                if let Some(old) = &held {
                    if old.barbarian && !barb_top && old.bounty_escrow.0 > 0 {
                        self.credit_holders(&chain_id, &new_territory, old.bounty_escrow.0);
                        self.log_activity(
                            "bounty",
                            format!("Reclaim bounty of {} WIELER paid for {}", whole(old.bounty_escrow.0), chain.name),
                            Some(chain_id.clone()),
                            None,
                        );
                    }
                }

                // Stats.
                for w in &winners {
                    let mut r = self.raiders.get(&w.account_id).cloned().unwrap_or_default();
                    r.conquests += 1;
                    r.burned = U128(r.burned.0 + bps(w.amount.0, burn_bps));
                    if let Some(c) = r.clan.clone() {
                        if let Some(cl) = self.clans.get_mut(&c) {
                            cl.conquests += 1;
                        }
                    }
                    self.raiders.insert(w.account_id.clone(), r);
                }

                // Burn.
                if burned > 0 {
                    self.total_burned += burned;
                    let _ = ext_ft::ext(self.config.token.clone())
                        .with_attached_deposit(ONE_YOCTO)
                        .with_static_gas(GAS_BURN)
                        .burn(U128(burned), Some(format!("conquest of {} epoch {}", chain_id, epoch_id)));
                    emit("Burned", json!({"epoch": epoch_id, "chain": chain_id, "amount": U128(burned)}));
                    self.supply.push(SupplyPoint {
                        epoch: epoch_id,
                        ts_ms: U64(env::block_timestamp_ms()),
                        burned_total: U128(self.total_burned),
                        chain: Some(chain_id.clone()),
                    });
                    self.log_activity(
                        "burn",
                        format!("{} WIELER burned this epoch", whole(burned)),
                        Some(chain_id.clone()),
                        None,
                    );
                }

                // Territory sub-account on first conquest (P1).
                if first && self.config.create_territory_accounts {
                    if let Ok(sub) = format!("{}.{}", chain_id, env::current_account_id()).parse::<AccountId>() {
                        let _ = Promise::new(sub.clone())
                            .create_account()
                            .transfer(NearToken::from_millinear(10));
                        chain.territory_account = Some(sub);
                    }
                }

                chain.conquest_count += 1;
                let flag_id = self.create_flag(&chain, epoch_id, &winners, barb_top);
                outcome.flag_id = Some(flag_id);
                self.territories.insert(chain_id.clone(), new_territory);

                let event = if held.is_none() { "Conquered" } else { "TerritoryChanged" };
                emit(event, json!({"epoch": epoch_id, "chain": chain_id, "winners": outcome.winners, "burned": U128(burned), "flag_id": flag_id, "barbarian": barb_top}));
                if held.is_some() {
                    emit("Conquered", json!({"epoch": epoch_id, "chain": chain_id, "reconquest": true}));
                }
                self.log_activity(
                    "transfer",
                    format!(
                        "Territory {}: {}",
                        if held.is_none() { "conquered" } else { "transferred" },
                        chain.name
                    ),
                    Some(chain_id.clone()),
                    Some(flag_id),
                );
            }
            self.chains.insert(chain_id, chain);
        }

        // Archive and roll over.
        let mut closed = self.current.clone();
        closed.closed = true;
        let flag_id = outcome.flag_id;
        emit("EpochClosed", json!({"epoch": epoch_id, "kind": outcome.kind, "chain": outcome.chain, "keeper": keeper}));
        closed.outcome = Some(outcome);
        self.epochs.insert(epoch_id, closed);
        let len = self.config.epoch_length_ms.0 * 1_000_000;
        self.current = Epoch {
            id: epoch_id + 1,
            start_ns: U64(now),
            end_ns: U64(now + len),
            chain_stakes: vec![],
            total: U128(0),
            closed: false,
            outcome: None,
        };
        flag_id
    }

    fn credit_holders(&mut self, chain: &str, t: &Territory, amount: u128) {
        if amount == 0 || t.total_stake.0 == 0 {
            return;
        }
        let weight: u128 = t.holders.iter().map(|h| h.stake.0).sum();
        for h in &t.holders {
            let share = mul_div(amount, h.stake.0, weight);
            let key = (chain.to_string(), h.account_id.clone());
            let cur = self.rewards.get(&key).copied().unwrap_or(0);
            self.rewards.insert(key, cur + share);
        }
    }

    fn dominant_clan(&self, winners: &[StakeEntry]) -> Option<String> {
        let mut totals: Vec<(String, u128)> = vec![];
        for w in winners {
            if let Some(c) = self.raiders.get(&w.account_id).and_then(|r| r.clan.clone()) {
                match totals.iter_mut().find(|(n, _)| *n == c) {
                    Some(t) => t.1 += w.amount.0,
                    None => totals.push((c, w.amount.0)),
                }
            }
        }
        totals.into_iter().max_by(|a, b| a.1.cmp(&b.1)).map(|t| t.0)
    }

    fn create_flag(&mut self, chain: &Chain, epoch: u64, winners: &[StakeEntry], barbarian: bool) -> u64 {
        // Only NEAR account ids are engraved, ranked by stake, up to the payload limit.
        let prefix = if barbarian { format!("WIELER BARB E{} ", epoch) } else { format!("WIELER E{} ", epoch) };
        let mut memo = prefix;
        let mut names = vec![];
        for w in winners {
            let sep = if names.is_empty() { "" } else { "," };
            let candidate = format!("{}{}{}", memo, sep, w.account_id);
            if candidate.len() > chain.payload_limit as usize {
                break;
            }
            memo = candidate;
            names.push(w.account_id.clone());
        }
        let id = self.flags.len() as u64;
        self.flags.push(Flag {
            id,
            chain: chain.id.clone(),
            epoch,
            names,
            memo,
            barbarian,
            status: FlagStatus::AwaitingTx,
            tx_params: None,
            unsigned_tx: None,
            payload: None,
            signed_tx: None,
            expected_tx_hash: None,
            tx_hash: None,
            explorer_url: None,
            created_ms: U64(env::block_timestamp_ms()),
            error: None,
        });
        self.log_activity(
            "flag",
            format!("WIELER flag planted on {}", chain.name),
            Some(chain.id.clone()),
            Some(id),
        );
        id
    }

    // ------------------------------------------------------------ flags / chain signatures

    /// Builds the flag transaction from the stored flag plus foreign-chain parameters,
    /// checks guardrails and asks the MPC signer to sign it. Anyone may call (broadcaster).
    /// Attach at least 1 yoctoNEAR... the contract pays the MPC deposit itself; attach 300 Tgas.
    pub fn request_flag_signature(&mut self, flag_id: u64, params: TxParams) -> Promise {
        let mut flag = self.flags.get(flag_id as u32).cloned().expect("no flag");
        require!(flag.status != FlagStatus::Broadcast, "flag already broadcast");
        let now_ms = env::block_timestamp_ms();
        let prev = read_sign_request(flag_id);
        if flag.status == FlagStatus::Signing {
            // A flag from before request tracking has no record and counts as long expired.
            let started = prev.as_ref().map(|r| r.started_ms.0).unwrap_or(0);
            require!(
                now_ms >= started.saturating_add(SIGNING_TIMEOUT_MS),
                "signature already requested; it can be retried after the signing timeout"
            );
        }
        let request_id = prev.map(|r| r.request_id + 1).unwrap_or(1);
        let chain = self.chains.get(&flag.chain).cloned().expect("no chain");
        let memo = flag.memo.as_bytes().to_vec();
        let pk = hex::decode(chain.derived_pubkey.trim_start_matches("0x")).unwrap();

        let (unsigned, payload, domain, scheme): (Vec<u8>, Vec<u8>, u32, &str) = match (&params, chain.kind) {
            (
                TxParams::Evm { nonce, max_fee_per_gas, max_priority_fee_per_gas, gas_limit },
                ChainKind::Evm,
            ) => {
                require!(*gas_limit >= tx::evm_min_gas(&memo), "gas_limit too low");
                require!(*gas_limit <= 200_000, "gas_limit too high");
                require!(max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "priority fee above max fee");
                require!(
                    max_fee_per_gas.0 * (*gas_limit as u128) <= chain.max_fee.0,
                    "fee above configured cap"
                );
                let etx = self.evm_tx(&chain, *nonce, max_fee_per_gas.0, max_priority_fee_per_gas.0, *gas_limit, memo);
                (etx.unsigned(), etx.signing_hash().to_vec(), 0, "Ecdsa")
            }
            (TxParams::Bitcoin { txid, vout, value, fee }, ChainKind::Bitcoin) => {
                require!(fee.0 > 0 && fee.0 as u128 <= chain.max_fee.0, "fee above configured cap");
                require!(value.0 >= fee.0 + 546, "UTXO too small for dust change");
                require!(memo.len() <= 80, "memo too long for OP_RETURN");
                let btx = self.btc_tx(&pk, txid, *vout, value.0, fee.0, memo);
                (btx.non_witness(), btx.sighash().to_vec(), 0, "Ecdsa")
            }
            (TxParams::Solana { recent_blockhash }, ChainKind::Solana) => {
                let bh: [u8; 32] = bs58::decode(recent_blockhash)
                    .into_vec()
                    .expect("blockhash base58")
                    .try_into()
                    .expect("blockhash 32 bytes");
                let payer: [u8; 32] = pk.clone().try_into().unwrap();
                let msg = tx::solana_message(&payer, &bh, &memo);
                (msg.clone(), msg, 1, "Eddsa")
            }
            _ => env::panic_str("params do not match chain kind"),
        };

        flag.status = FlagStatus::Signing;
        flag.tx_params = Some(serde_json::to_string(&params).unwrap());
        flag.unsigned_tx = Some(hex::encode(&unsigned));
        flag.payload = Some(hex::encode(&payload));
        flag.error = None;
        self.flags.replace(flag_id as u32, flag);
        write_sign_request(flag_id, &SignRequest { request_id, started_ms: U64(now_ms) });

        let args = json!({
            "request": {
                "payload_v2": { scheme: hex::encode(&payload) },
                "path": chain.path,
                "domain_id": domain,
            }
        });
        Promise::new(self.config.mpc_contract.clone())
            .function_call("sign".to_string(), args.to_string().into_bytes(), ONE_YOCTO, GAS_MPC_SIGN)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_SIGNATURE)
                    .on_signature(flag_id, request_id),
            )
    }

    fn evm_tx(&self, chain: &Chain, nonce: u64, max_fee: u128, prio: u128, gas: u64, memo: Vec<u8>) -> tx::EvmTx {
        let to: [u8; 20] = hex::decode(chain.derived_address.trim_start_matches("0x"))
            .expect("evm address hex")
            .try_into()
            .expect("evm address 20 bytes");
        tx::EvmTx {
            chain_id: chain.evm_chain_id.unwrap(),
            nonce,
            max_priority_fee_per_gas: prio,
            max_fee_per_gas: max_fee,
            gas_limit: gas,
            to,
            data: memo,
        }
    }

    fn btc_tx(&self, pk: &[u8], txid: &str, vout: u32, value: u64, fee: u64, memo: Vec<u8>) -> tx::BtcTx {
        let mut prev = parse_hex32(txid);
        prev.reverse();
        tx::BtcTx {
            prev_txid_le: prev,
            vout,
            input_value: value,
            change_value: value - fee,
            pkh: tx::hash160(pk),
            memo,
        }
    }

    /// MPC callback: stores the signed transaction and its expected foreign tx hash.
    /// Results for a superseded request are ignored, and anything unexpected marks the flag
    /// `Failed` rather than panicking, so the flag never stays stuck in `Signing`.
    #[private]
    pub fn on_signature(
        &mut self,
        flag_id: u64,
        request_id: u64,
        #[callback_result] signature: Result<Value, PromiseError>,
    ) -> Option<String> {
        let mut flag = self.flags.get(flag_id as u32).cloned().expect("no flag");
        let latest = read_sign_request(flag_id).map(|r| r.request_id);
        if latest != Some(request_id) || flag.status != FlagStatus::Signing {
            log!("flag {}: ignoring result of superseded sign request {}", flag_id, request_id);
            return None;
        }
        let chain = self.chains.get(&flag.chain).cloned().expect("no chain");
        let sig = match signature {
            Ok(v) => v,
            Err(_) => {
                flag.status = FlagStatus::Failed;
                flag.error = Some("MPC signing failed or timed out; retry request_flag_signature".into());
                self.flags.replace(flag_id as u32, flag);
                return None;
            }
        };
        let params: TxParams = serde_json::from_str(flag.tx_params.as_ref().unwrap()).unwrap();
        let memo = flag.memo.as_bytes().to_vec();
        let pk = hex::decode(chain.derived_pubkey.trim_start_matches("0x")).unwrap();

        let built = match (params, chain.kind) {
            (TxParams::Evm { nonce, max_fee_per_gas, max_priority_fee_per_gas, gas_limit }, ChainKind::Evm) => {
                parse_ecdsa(&sig).map(|(r, s, v)| {
                    let etx = self.evm_tx(&chain, nonce, max_fee_per_gas.0, max_priority_fee_per_gas.0, gas_limit, memo);
                    let signed = etx.signed(&r, &s, v);
                    let hash = format!("0x{}", hex::encode(env::keccak256_array(&signed)));
                    (signed, hash)
                })
            }
            (TxParams::Bitcoin { txid, vout, value, fee }, ChainKind::Bitcoin) => parse_ecdsa(&sig).map(|(r, s, _)| {
                let btx = self.btc_tx(&pk, &txid, vout, value.0, fee.0, memo);
                (btx.signed(&r, &s, &pk), hex::encode(btx.txid()))
            }),
            (TxParams::Solana { .. }, ChainKind::Solana) => parse_ed25519(&sig).map(|sig64| {
                let msg = hex::decode(flag.unsigned_tx.as_ref().unwrap()).unwrap();
                (tx::solana_signed(&msg, &sig64), bs58::encode(sig64).into_string())
            }),
            _ => None,
        };
        let Some((signed, hash)) = built else {
            flag.status = FlagStatus::Failed;
            flag.error = Some("unexpected MPC signature format; retry request_flag_signature".into());
            self.flags.replace(flag_id as u32, flag);
            return None;
        };
        flag.status = FlagStatus::Signed;
        flag.signed_tx = Some(hex::encode(&signed));
        flag.expected_tx_hash = Some(hash.clone());
        emit("FlagSigned", json!({"flag_id": flag_id, "chain": flag.chain, "tx_hash": hash}));
        self.flags.replace(flag_id as u32, flag);
        Some(hash)
    }

    /// Records the foreign tx hash after broadcast. It must equal the hash of the signed
    /// transaction the contract built, so a flag can only link to its own transaction.
    pub fn confirm_broadcast(&mut self, flag_id: u64, tx_hash: String) {
        let mut flag = self.flags.get(flag_id as u32).cloned().expect("no flag");
        require!(flag.status == FlagStatus::Signed, "flag is not signed");
        let expected = flag.expected_tx_hash.clone().unwrap();
        require!(
            expected.trim_start_matches("0x").eq_ignore_ascii_case(tx_hash.trim_start_matches("0x")),
            format!("tx hash does not match signed flag ({})", expected)
        );
        let chain = self.chains.get(&flag.chain).cloned().unwrap();
        flag.status = FlagStatus::Broadcast;
        flag.tx_hash = Some(expected.clone());
        flag.explorer_url = Some(format!("{}{}", chain.explorer_tx_url, expected));
        emit("FlagBroadcast", json!({"flag_id": flag_id, "chain": flag.chain, "tx_hash": expected}));
        self.log_activity(
            "broadcast",
            format!("Flag #{} confirmed on {}", flag_id, chain.name),
            Some(flag.chain.clone()),
            Some(flag_id),
        );
        self.flags.replace(flag_id as u32, flag);
    }

    fn log_activity(&mut self, kind: &str, text: String, chain: Option<String>, flag_id: Option<u64>) {
        self.activity.push(Activity {
            kind: kind.to_string(),
            text,
            chain,
            flag_id,
            ts_ms: U64(env::block_timestamp_ms()),
        });
    }

    // ------------------------------------------------------------ views

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_chains(&self) -> Vec<Chain> {
        self.chain_ids.iter().filter_map(|id| self.chains.get(id).cloned()).collect()
    }

    pub fn get_map(&self) -> MapView {
        let chains = self
            .chain_ids
            .iter()
            .filter_map(|id| {
                let chain = self.chains.get(id)?.clone();
                let territory = self.territories.get(id).cloned();
                let cs = self.current.chain_stakes.iter().find(|c| &c.chain == id);
                let target = match &territory {
                    Some(t) => t.total_stake.0.max(chain.min_target.0),
                    None => chain.min_target.0,
                };
                Some(MapChain {
                    chain,
                    territory,
                    epoch_stake: cs.map(|c| c.amount).unwrap_or(U128(0)),
                    epoch_stakers: cs.map(|c| c.stakers).unwrap_or(0),
                    target: U128(target),
                })
            })
            .collect();
        MapView {
            epoch: self.current.clone(),
            now_ms: U64(env::block_timestamp_ms()),
            chains,
            total_burned: U128(self.total_burned),
            flags: self.flags.len() as u64,
            clans: self.clans.len(),
            barbarian: self.config.barbarian.clone(),
            barbarian_attestation_url: self.config.barbarian_attestation_url.clone(),
        }
    }

    pub fn get_current_epoch(&self) -> Epoch {
        self.current.clone()
    }

    pub fn get_epoch(&self, id: u64) -> Option<Epoch> {
        if id == self.current.id {
            Some(self.current.clone())
        } else {
            self.epochs.get(&id).cloned()
        }
    }

    pub fn get_stakers(&self, epoch: u64, chain: String) -> Vec<StakeEntry> {
        self.stakers.get(&(epoch, chain)).cloned().unwrap_or_default()
    }

    pub fn get_flag(&self, id: u64) -> Option<Flag> {
        self.flags.get(id as u32).cloned()
    }

    /// The flag's latest MPC sign request, if any.
    pub fn get_sign_request(&self, flag_id: u64) -> Option<SignRequestView> {
        read_sign_request(flag_id).map(|r| SignRequestView {
            request_id: r.request_id,
            started_ms: r.started_ms,
            retry_after_ms: U64(r.started_ms.0 + SIGNING_TIMEOUT_MS),
        })
    }

    /// Newest first.
    pub fn get_flags(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Flag> {
        let len = self.flags.len() as u64;
        let skip = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50);
        (0..len)
            .rev()
            .skip(skip as usize)
            .take(limit as usize)
            .filter_map(|i| self.flags.get(i as u32).cloned())
            .collect()
    }

    pub fn get_territories(&self) -> Vec<Territory> {
        self.chain_ids.iter().filter_map(|id| self.territories.get(id).cloned()).collect()
    }

    pub fn get_raider(&self, account_id: AccountId) -> Option<Raider> {
        self.raiders.get(&account_id).cloned()
    }

    pub fn get_raiders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<(AccountId, Raider)> {
        self.raiders
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(200) as usize)
            .map(|(a, r)| (a.clone(), r.clone()))
            .collect()
    }

    pub fn get_clans(&self) -> Vec<Clan> {
        self.clans.values().cloned().collect()
    }

    /// Newest first.
    pub fn get_activity(&self, limit: Option<u32>) -> Vec<Activity> {
        let len = self.activity.len();
        let n = limit.unwrap_or(20).min(len);
        (0..n).filter_map(|i| self.activity.get(len - 1 - i).cloned()).collect()
    }

    pub fn get_supply_history(&self) -> Vec<SupplyPoint> {
        self.supply.iter().cloned().collect()
    }

    pub fn get_account_stakes(&self, account_id: AccountId) -> Vec<AccountStakeView> {
        let idx = self.account_stakes.get(&account_id).cloned().unwrap_or_default();
        idx.into_iter()
            .filter_map(|(epoch, chain)| {
                let entry = self
                    .stakers
                    .get(&(epoch, chain.clone()))?
                    .iter()
                    .find(|e| e.account_id == account_id)?
                    .clone();
                let claimable = self
                    .epochs
                    .get(&epoch)
                    .filter(|_| !entry.settled)
                    .map(|ep| U128(self.settlement(ep, &chain, &account_id, entry.amount.0)));
                Some(AccountStakeView { epoch, chain, amount: entry.amount, settled: entry.settled, claimable })
            })
            .collect()
    }

    pub fn get_rewards(&self, account_id: AccountId) -> Vec<(String, U128)> {
        self.chain_ids
            .iter()
            .filter_map(|c| {
                self.rewards
                    .get(&(c.clone(), account_id.clone()))
                    .map(|v| (c.clone(), U128(*v)))
            })
            .collect()
    }

    pub fn get_pending(&self, account_id: AccountId) -> U128 {
        U128(self.pending.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_total_burned(&self) -> U128 {
        U128(self.total_burned)
    }
}

/// Parses the MPC's secp256k1 response; None if it is not in the expected shape.
fn parse_ecdsa(v: &Value) -> Option<([u8; 32], [u8; 32], u8)> {
    // {"scheme":"Secp256k1","big_r":{"affine_point":"02.."},"s":{"scalar":".."},"recovery_id":0}
    let v = v.get("Secp256k1").unwrap_or(v);
    let big_r = hex::decode(v["big_r"]["affine_point"].as_str()?).ok()?;
    let s = hex::decode(v["s"]["scalar"].as_str()?.trim_start_matches("0x")).ok()?;
    let rid = u8::try_from(v["recovery_id"].as_u64()?).ok()?;
    if big_r.len() != 33 {
        return None;
    }
    Some((big_r[1..33].try_into().ok()?, s.try_into().ok()?, rid))
}

/// Parses the MPC's Ed25519 response; None if it is not in the expected shape.
fn parse_ed25519(v: &Value) -> Option<[u8; 64]> {
    // {"scheme":"Ed25519","signature":[..64 bytes..]} (also accepts hex)
    let v = v.get("Ed25519").unwrap_or(v);
    let sig = &v["signature"];
    let bytes: Vec<u8> = if let Some(arr) = sig.as_array() {
        arr.iter().map(|b| b.as_u64().and_then(|x| u8::try_from(x).ok())).collect::<Option<_>>()?
    } else {
        hex::decode(sig.as_str()?).ok()?
    };
    bytes.try_into().ok()
}

#[near]
impl FungibleTokenReceiver for Contract {
    /// `msg` names the target chain, either plain ("bitcoin") or JSON {"chain":"bitcoin"}.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.config.token, "only WIELER can be staked");
        let chain = serde_json::from_str::<Value>(&msg)
            .ok()
            .and_then(|v| v.get("chain").and_then(|c| c.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| msg.trim().to_string());
        match self.internal_stake(&sender_id, amount.0, &chain) {
            Ok(()) => PromiseOrValue::Value(U128(0)),
            Err(reason) => {
                log!("Stake refunded: {}", reason);
                PromiseOrValue::Value(amount)
            }
        }
    }
}

#[cfg(test)]
mod tests;
