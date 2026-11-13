// Deploys WIELER to NEAR testnet under MASTER_ACCOUNT:
//   wieler.<master>            NEP-141 token (fixed supply)
//   raid.wieler.<master>       raid game contract
//   pool.wieler.<master>       raid rewards pool (20%), seeds the Barbarian war chest
//   barbarian.wieler.<master>  the Barbarian's own account
//   alice/bob/carol.wieler.<master>  demo raiders
// Then derives the Chain Signatures wallets for Bitcoin testnet3, Sepolia and Solana devnet,
// registers them with add_chain, registers the Barbarian and writes the frontend config.
//
// Usage (WSL / Linux, keys in ~/.near-credentials):  MASTER_ACCOUNT=you.testnet node deploy.mjs
import fs from 'node:fs';
import path from 'node:path';
import { KeyPair, transactions } from 'near-api-js';
import {
  ROOT,
  DEPLOYMENT_FILE,
  NEAR,
  ONE_WIELER,
  TGAS,
  account,
  accountExists,
  btcAddress,
  call,
  derivedKey,
  env,
  evmAddress,
  hex,
  keyStore,
  log,
  secpCompressed,
  view,
  base58,
} from './lib.mjs';

const master = env.master;
if (!master) {
  console.error('Set MASTER_ACCOUNT (e.g. MASTER_ACCOUNT=wieler-demo.testnet) in scripts/.env or the environment.');
  process.exit(1);
}

const ids = {
  token: `wieler.${master}`,
  raid: `raid.wieler.${master}`,
  pool: `pool.wieler.${master}`,
  barbarian: `barbarian.wieler.${master}`,
  alice: `alice.wieler.${master}`,
  bob: `bob.wieler.${master}`,
  carol: `carol.wieler.${master}`,
};

const nearAmt = (n) => BigInt(Math.round(n * 1000)) * (NEAR / 1000n);
const FUND = {
  token: nearAmt(Number(process.env.FUND_TOKEN || 2.3)),
  raid: nearAmt(Number(process.env.FUND_RAID || 4.6)),
  sub: nearAmt(Number(process.env.FUND_SUB || 0.5)),
};

const wasm = (name) => fs.readFileSync(path.join(ROOT, 'contracts', 'res', `${name}.wasm`));

async function ensureAccount(creator, id, amount) {
  if (await accountExists(id)) {
    log(`✓ ${id} exists`);
    return;
  }
  const kp = KeyPair.fromRandom('ed25519');
  await keyStore.setKey(env.network, id, kp);
  const acc = await account(creator);
  await acc.createAccount(id, kp.getPublicKey(), amount);
  log(`+ created ${id} (${Number(amount / (NEAR / 1000n)) / 1000} NEAR)`);
}

async function hasCode(id) {
  const st = await (await account(id)).state();
  return st.code_hash !== '11111111111111111111111111111111';
}

async function main() {
  const bal = await (await account(master)).getAccountBalance();
  log(`master ${master}: ${Number(BigInt(bal.available) / (NEAR / 1000n)) / 1000} NEAR available`);
  const need = FUND.token + FUND.raid + FUND.sub * 5n;
  if (BigInt(bal.available) < need) {
    throw new Error(`master needs at least ${Number(need / (NEAR / 1000n)) / 1000} NEAR`);
  }

  // ---- accounts. The token account is funded with everything its sub-accounts need.
  await ensureAccount(master, ids.token, FUND.token + FUND.raid + FUND.sub * 5n);
  await ensureAccount(ids.token, ids.raid, FUND.raid);
  for (const k of ['pool', 'barbarian', 'alice', 'bob', 'carol']) await ensureAccount(ids.token, ids[k], FUND.sub);

  // ---- token
  if (!(await hasCode(ids.token))) {
    const acc = await account(ids.token);
    await acc.signAndSendTransaction({
      receiverId: ids.token,
      actions: [
        transactions.deployContract(wasm('wieler_token')),
        transactions.functionCall('new', { rewards_pool: ids.pool, team: master }, 100n * TGAS, 0n),
      ],
    });
    log(`✓ token deployed to ${ids.token}`);
  } else log(`✓ token already deployed`);

  // ---- raid
  if (!(await hasCode(ids.raid))) {
    const acc = await account(ids.raid);
    await acc.signAndSendTransaction({
      receiverId: ids.raid,
      actions: [
        transactions.deployContract(wasm('wieler_raid')),
        transactions.functionCall(
          'new',
          { owner: master, token: ids.token, mpc_contract: env.mpc, epoch_length_ms: env.epochMs.toString() },
          100n * TGAS,
          0n,
        ),
      ],
    });
    log(`✓ raid deployed to ${ids.raid} (epoch ${Number(env.epochMs) / 60000} min)`);
  } else log(`✓ raid already deployed`);

  // ---- token storage registrations
  const bounds = await view(ids.token, 'storage_balance_bounds');
  for (const id of [ids.raid, ids.barbarian, ids.alice, ids.bob, ids.carol]) {
    const reg = await view(ids.token, 'storage_balance_of', { account_id: id });
    if (!reg) {
      await call(master, ids.token, 'storage_deposit', { account_id: id, registration_only: true }, { deposit: BigInt(bounds.min), gas: 30n * TGAS });
      log(`✓ registered ${id} on token`);
    }
  }

  // ---- derived foreign wallets (Chain Signatures), predecessor = raid contract
  const btcKey = secpCompressed(await derivedKey(ids.raid, 'wieler/btc', 0));
  const evmKey = secpCompressed(await derivedKey(ids.raid, 'wieler/evm', 0));
  let solPub = null;
  try {
    const d = await derivedKey(ids.raid, 'wieler/sol', 1);
    solPub = base58.decode(d.split(':')[1]);
  } catch (e) {
    log(`! could not derive the Solana (ed25519) key: ${e.message}`);
  }
  const chains = [
    {
      id: 'bitcoin',
      name: 'Bitcoin',
      kind: 'Bitcoin',
      path: 'wieler/btc',
      derived_pubkey: hex.encode(btcKey.compressed),
      derived_address: btcAddress(btcKey.compressed, 'tb'),
      evm_chain_id: null,
      btc_hrp: 'tb',
      explorer_tx_url: env.btcExplorer,
      payload_limit: 80,
      max_fee: '6000',
      min_target: (12_500_000n * ONE_WIELER).toString(),
    },
    {
      id: 'ethereum',
      name: 'Ethereum',
      kind: 'Evm',
      path: 'wieler/evm',
      derived_pubkey: hex.encode(evmKey.compressed),
      derived_address: evmAddress(evmKey.uncompressed),
      evm_chain_id: 11155111,
      btc_hrp: null,
      explorer_tx_url: 'https://sepolia.etherscan.io/tx/',
      payload_limit: 80,
      max_fee: (3n * 10n ** 15n).toString(),
      min_target: (10_000_000n * ONE_WIELER).toString(),
    },
  ];
  if (solPub) {
    chains.push({
      id: 'solana',
      name: 'Solana',
      kind: 'Solana',
      path: 'wieler/sol',
      derived_pubkey: hex.encode(solPub),
      derived_address: base58.encode(solPub),
      evm_chain_id: null,
      btc_hrp: null,
      explorer_tx_url: 'https://explorer.solana.com/tx/?cluster=devnet',
      payload_limit: 80,
      max_fee: '10000',
      min_target: (8_000_000n * ONE_WIELER).toString(),
    });
  }
  for (const c of chains) {
    await call(master, ids.raid, 'add_chain', c, { gas: 50n * TGAS });
    log(`✓ chain ${c.name}: ${c.derived_address}`);
  }

  // ---- Barbarian
  await call(master, ids.raid, 'register_barbarian', { account: ids.barbarian, attestation_url: process.env.BARBARIAN_ATTESTATION_URL || null }, { gas: 30n * TGAS });
  // Barbarian stake floor sized for a small testnet game (contract default is 250K).
  const cfg = await view(ids.raid, 'get_config');
  const floor = (BigInt(process.env.BARBARIAN_FLOOR || 5000) * ONE_WIELER).toString();
  if (cfg.barbarian_floor !== floor) {
    await call(master, ids.raid, 'set_config', { config: { ...cfg, barbarian_floor: floor } }, { gas: 30n * TGAS });
    log(`✓ Barbarian floor set to ${process.env.BARBARIAN_FLOOR || 5000} WIELER`);
  }
  const chest = await view(ids.token, 'ft_balance_of', { account_id: ids.barbarian });
  if (BigInt(chest) === 0n) {
    const seed = BigInt(process.env.BARBARIAN_SEED || 5_000_000) * ONE_WIELER;
    await call(ids.pool, ids.token, 'ft_transfer', { receiver_id: ids.barbarian, amount: seed.toString(), memo: 'Barbarian war chest seed' }, { deposit: 1n, gas: 30n * TGAS });
    log(`✓ Barbarian war chest seeded from the rewards pool`);
  }

  // ---- demo raiders claim from the faucet
  for (const k of ['alice', 'bob', 'carol']) {
    const b = await view(ids.token, 'ft_balance_of', { account_id: ids[k] });
    if (BigInt(b) === 0n) {
      await call(ids[k], ids.token, 'faucet', {}, { gas: 30n * TGAS });
      log(`✓ ${k} claimed faucet WIELER`);
    }
  }

  // ---- write configs
  const out = { network: env.network, nodeUrl: env.nodeUrl, master, ...ids, chains: chains.map((c) => ({ id: c.id, address: c.derived_address })) };
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(out, null, 2));
  const fe = path.join(ROOT, 'frontend', 'src', 'config', 'deployment.json');
  fs.writeFileSync(
    fe,
    JSON.stringify(
      {
        networkId: env.network,
        nodeUrl: env.nodeUrl,
        tokenContract: ids.token,
        raidContract: ids.raid,
        barbarian: ids.barbarian,
        explorer: env.network === 'testnet' ? 'https://testnet.nearblocks.io' : 'https://nearblocks.io',
      },
      null,
      2,
    ) + '\n',
  );
  log('✓ wrote scripts/.deployment.json and frontend/src/config/deployment.json');
  console.log('\nFund these foreign wallets from testnet faucets so flags can be broadcast:');
  for (const c of chains) console.log(`  ${c.name.padEnd(9)} ${c.derived_address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
