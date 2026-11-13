// Shared helpers for the WIELER scripts (deploy, keeper/broadcaster, Barbarian agent, demo).
// Keys are read from the near-cli legacy keychain: ~/.near-credentials/<network>/<account>.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyPair, connect, keyStores } from 'near-api-js';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { keccak_256 } from '@noble/hashes/sha3';
import { base58, bech32, hex } from '@scure/base';

export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(DIR, '..');
export const TGAS = 1_000_000_000_000n;
export const ONE_WIELER = 10n ** 18n;
export const NEAR = 10n ** 24n;

// ------------------------------------------------------------------ env

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(path.join(DIR, '.env'));

export const env = {
  network: process.env.NEAR_NETWORK || 'testnet',
  nodeUrl: process.env.NEAR_NODE_URL || 'https://test.rpc.fastnear.com',
  master: process.env.MASTER_ACCOUNT,
  mpc: process.env.MPC_CONTRACT || 'v1.signer-prod.testnet',
  epochMs: BigInt(process.env.EPOCH_MS || 10 * 60 * 1000),
  sepoliaRpc: process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
  solanaRpc: process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
  btcApi: process.env.BTC_API || 'https://blockstream.info/testnet/api',
  btcExplorer: process.env.BTC_EXPLORER || 'https://blockstream.info/testnet/tx/',
};

export const DEPLOYMENT_FILE = path.join(DIR, '.deployment.json');

export function deployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) throw new Error('No scripts/.deployment.json. Run `node deploy.mjs` first.');
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
}

// ------------------------------------------------------------------ near

// Keys come from NEAR_SIGNER_KEYS when set (servers: "account.testnet=ed25519:...,other=ed25519:..."),
// otherwise from the near-cli legacy keychain in ~/.near-credentials.
function makeKeyStore() {
  const spec = process.env.NEAR_SIGNER_KEYS;
  if (!spec) return new keyStores.UnencryptedFileSystemKeyStore(path.join(os.homedir(), '.near-credentials'));
  const store = new keyStores.InMemoryKeyStore();
  for (const pair of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const i = pair.indexOf('=');
    if (i < 1) throw new Error('NEAR_SIGNER_KEYS entries look like account=ed25519:<secret>');
    store.setKey(env.network, pair.slice(0, i), KeyPair.fromString(pair.slice(i + 1)));
  }
  return store;
}
export const keyStore = makeKeyStore();
let _near;
export async function near() {
  if (!_near) _near = await connect({ networkId: env.network, keyStore, nodeUrl: env.nodeUrl });
  return _near;
}
export async function account(id) {
  return (await near()).account(id);
}

export async function view(contractId, methodName, args = {}) {
  const n = await near();
  const res = await n.connection.provider.query({
    request_type: 'call_function',
    finality: 'optimistic',
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  const text = Buffer.from(res.result).toString();
  return text ? JSON.parse(text) : null;
}

export async function call(signerId, contractId, methodName, args = {}, { gas = 100n * TGAS, deposit = 0n } = {}) {
  const acc = await account(signerId);
  const outcome = await acc.functionCall({ contractId, methodName, args, gas, attachedDeposit: deposit });
  const status = outcome.status;
  if (status && status.Failure) throw new Error(JSON.stringify(status.Failure));
  let value = null;
  if (status && typeof status.SuccessValue === 'string' && status.SuccessValue.length) {
    try {
      value = JSON.parse(Buffer.from(status.SuccessValue, 'base64').toString());
    } catch {
      value = null;
    }
  }
  return { value, hash: outcome.transaction.hash, outcome };
}

export async function accountExists(id) {
  try {
    await (await account(id)).state();
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ chain signatures

/** Parses "secp256k1:<base58 64 bytes>" from the MPC contract into the compressed key. */
export function secpCompressed(derived) {
  const raw = base58.decode(derived.split(':')[1]);
  const xy = raw.length === 65 ? raw.slice(1) : raw;
  const x = xy.slice(0, 32);
  const y = xy.slice(32);
  const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
  return { compressed: Uint8Array.from([prefix, ...x]), uncompressed: xy };
}

export function btcAddress(compressed, hrp = 'tb') {
  const pkh = ripemd160(sha256(compressed));
  const words = bech32.toWords(pkh);
  return bech32.encode(hrp, [0, ...words]);
}

export function evmAddress(uncompressed64) {
  return '0x' + hex.encode(keccak_256(uncompressed64).slice(12));
}

export async function derivedKey(predecessor, pathStr, domainId) {
  return view(env.mpc, 'derived_public_key', { path: pathStr, predecessor, domain_id: domainId });
}

// ------------------------------------------------------------------ misc

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmt = (v) => (Number(BigInt(v) / 10n ** 15n) / 1000).toLocaleString('en-US');
export function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}
export { base58, hex };
