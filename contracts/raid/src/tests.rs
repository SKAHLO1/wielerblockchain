use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const W: u128 = 1_000_000_000_000_000_000;
const EPOCH_MS: u64 = 60_000;

fn token() -> AccountId {
    "wieler.test".parse().unwrap()
}
fn owner() -> AccountId {
    "owner.test".parse().unwrap()
}
fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: AccountId, ts_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("raid.wieler.test".parse().unwrap())
        .predecessor_account_id(predecessor)
        .block_timestamp(ts_ms * 1_000_000)
        .account_balance(NearToken::from_near(10));
    testing_env!(b.build());
}

fn setup() -> Contract {
    ctx(owner(), 0);
    let mut c = Contract::new(owner(), token(), "v1.signer-prod.testnet".parse().unwrap(), U64(EPOCH_MS));
    // A valid compressed secp256k1 pubkey (generator point G).
    let g = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    let pkh = tx::hash160(&hex::decode(g).unwrap());
    c.add_chain(
        "bitcoin".into(),
        "Bitcoin".into(),
        ChainKind::Bitcoin,
        "wieler/btc".into(),
        g.into(),
        tx::p2wpkh_address("tb", &pkh),
        None,
        Some("tb".into()),
        "https://mempool.space/testnet4/tx/".into(),
        80,
        U128(5_000),
        U128(1_000_000 * W),
    );
    c.add_chain(
        "ethereum".into(),
        "Ethereum".into(),
        ChainKind::Evm,
        "wieler/evm".into(),
        g.into(),
        "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf".into(),
        Some(11155111),
        None,
        "https://sepolia.etherscan.io/tx/".into(),
        80,
        U128(2_000_000_000_000_000),
        U128(1_000_000 * W),
    );
    c
}

fn stake(c: &mut Contract, who: &str, amount: u128, chain: &str, ts: u64) -> U128 {
    ctx(token(), ts);
    match c.ft_on_transfer(acc(who), U128(amount), chain.to_string()) {
        PromiseOrValue::Value(v) => v,
        _ => panic!("unexpected promise"),
    }
}

#[test]
fn full_cycle_conquest_then_reconquest() {
    let mut c = setup();
    assert_eq!(stake(&mut c, "alice.test", 1_000 * W, "bitcoin", 1).0, 0);
    assert_eq!(stake(&mut c, "bob.test", 500 * W, "bitcoin", 2).0, 0);
    assert_eq!(stake(&mut c, "carol.test", 800 * W, r#"{"chain":"ethereum"}"#, 3).0, 0);

    // Too early.
    ctx(acc("keeper.test"), 10);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c2 = setup();
        ctx(acc("keeper.test"), 10);
        c2.close_epoch();
    }));
    assert!(r.is_err());

    ctx(acc("keeper.test"), EPOCH_MS + 1);
    let flag = c.close_epoch().expect("flag created");
    let ep = c.get_epoch(1).unwrap();
    let o = ep.outcome.unwrap();
    assert_eq!(o.kind, OutcomeKind::Conquered);
    assert_eq!(o.chain.as_deref(), Some("bitcoin"));
    assert_eq!(o.burned.0, 150 * W); // 10% of 1500
    assert_eq!(c.get_total_burned().0, 150 * W);
    let f = c.get_flag(flag).unwrap();
    assert_eq!(f.memo, "WIELER E1 alice.test,bob.test");
    assert_eq!(f.status, FlagStatus::AwaitingTx);
    // Keeper tip: 0.5% of 2300.
    assert_eq!(c.get_pending(acc("keeper.test")).0, 2300 * W * 50 / 10_000);

    // Settlements: alice loses 2% fee + 10% burn; carol only the fee.
    let a = c.get_account_stakes(acc("alice.test"));
    assert_eq!(a[0].claimable.unwrap().0, 1_000 * W * 88 / 100);
    let cs = c.get_account_stakes(acc("carol.test"));
    assert_eq!(cs[0].claimable.unwrap().0, 800 * W * 98 / 100);

    // Epoch 2: carol challenges bitcoin with more stake than the defenders.
    let t0 = EPOCH_MS + 1;
    stake(&mut c, "alice.test", 300 * W, "bitcoin", t0 + 5);
    stake(&mut c, "carol.test", 2_000 * W, "bitcoin", t0 + 6);
    ctx(acc("keeper.test"), t0 + EPOCH_MS + 1);
    c.close_epoch().expect("reconquest flag");
    let o2 = c.get_epoch(2).unwrap().outcome.unwrap();
    assert_eq!(o2.kind, OutcomeKind::Reconquered);
    assert_eq!(o2.burned.0, 100 * W); // 5% of 2000
    assert_eq!(o2.winners, vec![acc("carol.test")]);
    let t = c.get_territories();
    assert_eq!(t[0].holders[0].account_id, acc("carol.test"));
    // Holders of bitcoin (alice, bob) received 1% of 2300 split 1000:500.
    let alice_rewards = c.get_rewards(acc("alice.test"));
    assert_eq!(alice_rewards[0].1 .0, 2300 * W / 100 * 1000 / 1500);
    // Supply history stepped twice.
    assert_eq!(c.get_supply_history().len(), 3);
}

#[test]
fn defence_holds() {
    let mut c = setup();
    stake(&mut c, "alice.test", 1_000 * W, "bitcoin", 1);
    ctx(acc("k.test"), EPOCH_MS + 1);
    c.close_epoch();
    let t0 = EPOCH_MS + 1;
    stake(&mut c, "alice.test", 900 * W, "bitcoin", t0 + 1);
    stake(&mut c, "bob.test", 800 * W, "bitcoin", t0 + 2);
    ctx(acc("k.test"), t0 + EPOCH_MS + 1);
    assert!(c.close_epoch().is_none());
    let o = c.get_epoch(2).unwrap().outcome.unwrap();
    assert_eq!(o.kind, OutcomeKind::Defended);
    assert_eq!(o.burned.0, 0);
    assert_eq!(c.get_territories()[0].holders[0].account_id, acc("alice.test"));
}

#[test]
fn barbarian_caps_and_bounty() {
    let mut c = setup();
    ctx(owner(), 0);
    c.register_barbarian(acc("barbarian.test"), Some("https://example.org/attest".into()));
    // Floor is 250k; above it is refunded.
    assert_eq!(stake(&mut c, "barbarian.test", 300_000 * W, "ethereum", 1).0, 300_000 * W);
    assert_eq!(stake(&mut c, "barbarian.test", 200_000 * W, "ethereum", 2).0, 0);
    // One target per epoch.
    assert_eq!(stake(&mut c, "barbarian.test", 1 * W, "bitcoin", 3).0, 1 * W);
    ctx(acc("k.test"), EPOCH_MS + 1);
    c.close_epoch();
    let t = &c.get_territories()[0];
    assert!(t.barbarian);
    assert_eq!(t.bounty_escrow.0, 20_000 * W); // 10% of 200k
    // Barbarian settlement: fee 2% + burn 10% + escrow 10%.
    let b = c.get_account_stakes(acc("barbarian.test"));
    assert_eq!(b[0].claimable.unwrap().0, 200_000 * W * 78 / 100);

    // Players retake it and earn the escrow as a reclaim bounty.
    let t0 = EPOCH_MS + 1;
    stake(&mut c, "dave.test", 300_000 * W, "ethereum", t0 + 1);
    ctx(acc("k.test"), t0 + EPOCH_MS + 1);
    c.close_epoch();
    let terr = &c.get_territories()[0];
    assert!(!terr.barbarian);
    let r = c.get_rewards(acc("dave.test"));
    assert_eq!(r[0].1 .0, 20_000 * W);
}

#[test]
fn engraving_respects_payload_limit() {
    let mut c = setup();
    for i in 0..10 {
        stake(&mut c, &format!("raider-number-{}.testnet", i), (100 - i) as u128 * W, "bitcoin", 1 + i as u64);
    }
    ctx(acc("k.test"), EPOCH_MS + 1);
    let id = c.close_epoch().unwrap();
    let f = c.get_flag(id).unwrap();
    assert!(f.memo.len() <= 80);
    assert_eq!(f.names[0], acc("raider-number-0.testnet"));
}

#[test]
fn late_stake_is_refunded() {
    let mut c = setup();
    assert_eq!(stake(&mut c, "alice.test", 10 * W, "bitcoin", EPOCH_MS + 5).0, 10 * W);
    assert_eq!(stake(&mut c, "alice.test", 10 * W, "dogecoin", 5).0, 10 * W);
}

#[test]
fn evm_signed_tx_hash_is_deterministic() {
    let etx = tx::EvmTx {
        chain_id: 11155111,
        nonce: 0,
        max_priority_fee_per_gas: 1_000_000_000,
        max_fee_per_gas: 20_000_000_000,
        gas_limit: 30_000,
        to: [0x11; 20],
        data: b"WIELER E1 alice.testnet".to_vec(),
    };
    let u = etx.unsigned();
    assert_eq!(u[0], 0x02);
    let s = etx.signed(&[0x22; 32], &[0x33; 32], 1);
    assert!(s.len() > u.len());
}
