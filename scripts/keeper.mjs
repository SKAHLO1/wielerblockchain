// Keeper + flag broadcaster.
//  1. Calls close_epoch when the epoch has ended (earns the keeper tip).
//  2. For every flag awaiting a transaction, reads foreign-chain state (EVM nonce + fees,
//     a Bitcoin UTXO + fee rate, a Solana blockhash) and calls request_flag_signature. The
//     contract builds the transaction itself and asks the NEAR MPC network to sign it.
//  3. Broadcasts every signed flag to its chain and calls confirm_broadcast with the hash.
//
// Usage: node keeper.mjs [--once]      (KEEPER_ACCOUNT defaults to MASTER_ACCOUNT)
import { TGAS, call, deployment, env, hex, log, sleep, view } from './lib.mjs';

const dep = deployment();
const KEEPER = process.env.KEEPER_ACCOUNT || dep.master;
const ONCE = process.argv.includes('--once');

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}

// ------------------------------------------------------------------ foreign params

async function evmParams(chain, flag) {
  const nonce = Number(BigInt(await rpc(env.sepoliaRpc, 'eth_getTransactionCount', [chain.derived_address, 'pending'])));
  const block = await rpc(env.sepoliaRpc, 'eth_getBlockByNumber', ['latest', false]);
  const base = BigInt(block.baseFeePerGas);
  let prio = 1_500_000_000n;
  try {
    prio = BigInt(await rpc(env.sepoliaRpc, 'eth_maxPriorityFeePerGas', []));
  } catch {}
  const memo = Buffer.from(flag.memo);
  const gas = 21000 + [...memo].reduce((s, b) => s + (b === 0 ? 4 : 16), 0) + 2000;
  let maxFee = base * 2n + prio;
  const cap = BigInt(chain.max_fee) / BigInt(gas);
  if (maxFee > cap) maxFee = cap;
  if (prio > maxFee) prio = maxFee;
  const bal = BigInt(await rpc(env.sepoliaRpc, 'eth_getBalance', [chain.derived_address, 'latest']));
  if (bal < maxFee * BigInt(gas)) log(`  ! Sepolia wallet ${chain.derived_address} needs gas before broadcast (has ${bal} wei)`);
  return {
    kind: 'Evm',
    nonce,
    max_fee_per_gas: maxFee.toString(),
    max_priority_fee_per_gas: prio.toString(),
    gas_limit: gas,
  };
}

async function btcParams(chain, flag) {
  const api = chain.explorer_tx_url.replace(/\/tx\/?$/, '/api');
  const utxos = await (await fetch(`${api}/address/${chain.derived_address}/utxo`)).json();
  if (!utxos.length) throw new Error(`Bitcoin wallet ${chain.derived_address} has no UTXOs; fund it from a Bitcoin testnet faucet`);
  utxos.sort((a, b) => (b.status.confirmed - a.status.confirmed) || b.value - a.value);
  const u = utxos[0];
  let rate = 2;
  try {
    const fees = await (await fetch(`${api}/v1/fees/recommended`)).json();
    rate = Math.max(1, Math.ceil(fees.halfHourFee || fees.fastestFee || 2));
  } catch {}
  const vbytes = 11 + 68 + 31 + 11 + Buffer.from(flag.memo).length; // 1 P2WPKH in, change + OP_RETURN out
  const fee = Math.min(Number(chain.max_fee), Math.max(200, vbytes * rate));
  if (u.value < fee + 546) throw new Error(`UTXO ${u.txid}:${u.vout} too small`);
  return { kind: 'Bitcoin', txid: u.txid, vout: u.vout, value: String(u.value), fee: String(fee) };
}

async function solParams(chain) {
  const bal = await rpc(env.solanaRpc, 'getBalance', [chain.derived_address]);
  if (bal.value < 5000) throw new Error(`Solana wallet ${chain.derived_address} needs devnet SOL`);
  // 'confirmed' gives ~13 s more validity than 'finalized'; the blockhash expires after ~150 slots.
  const bh = await rpc(env.solanaRpc, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return { kind: 'Solana', recent_blockhash: bh.value.blockhash };
}

// ------------------------------------------------------------------ broadcast

async function broadcast(chain, flag) {
  const raw = flag.signed_tx;
  if (chain.kind === 'Evm') {
    try {
      return await rpc(env.sepoliaRpc, 'eth_sendRawTransaction', ['0x' + raw]);
    } catch (e) {
      if (/already known/i.test(e.message)) return flag.expected_tx_hash;
      throw e;
    }
  }
  if (chain.kind === 'Bitcoin') {
    const api = chain.explorer_tx_url.replace(/\/tx\/?$/, '/api');
    const r = await fetch(`${api}/tx`, { method: 'POST', body: raw });
    const text = await r.text();
    if (!r.ok) {
      if (/already in (block chain|mempool)|txn-already-known/i.test(text)) return flag.expected_tx_hash;
      throw new Error(`bitcoin broadcast: ${text}`);
    }
    return text.trim();
  }
  const b64 = Buffer.from(hex.decode(raw)).toString('base64');
  try {
    return await rpc(env.solanaRpc, 'sendTransaction', [b64, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
  } catch (e) {
    // This exact signed transaction already landed (e.g. the keeper stopped before
    // confirm_broadcast last time). That is success, not staleness: re-signing here
    // would put a second flag transaction on Solana.
    if (/already been processed|AlreadyProcessed/i.test(e.message)) return flag.expected_tx_hash;
    throw e;
  }
}

// Errors meaning the signed transaction can never land and needs fresh parameters.
const stale = (e) => /nonce too low|replacement|bad-txns-inputs|missingorspent|Blockhash not found/i.test(e.message);

// ------------------------------------------------------------------ loop

async function tick() {
  const map = await view(dep.raid, 'get_map');
  const now = Number(map.now_ms);
  const end = Number(BigInt(map.epoch.end_ns) / 1_000_000n);
  if (now >= end) {
    log(`epoch ${map.epoch.id} ended → close_epoch`);
    try {
      const { value } = await call(KEEPER, dep.raid, 'close_epoch', {}, { gas: 300n * TGAS });
      log(`  closed; flag ${value ?? 'none'}`);
    } catch (e) {
      log(`  close_epoch failed: ${e.message.slice(0, 200)}`);
    }
  }

  const chains = Object.fromEntries(map.chains.map((c) => [c.chain.id, c.chain]));
  const flags = await view(dep.raid, 'get_flags', { limit: 50 });
  for (const flag of flags.reverse()) {
    const chain = chains[flag.chain];
    if (!chain || flag.status === 'Broadcast' || flag.status === 'Signing') continue;
    try {
      if (flag.status === 'AwaitingTx' || flag.status === 'Failed') {
        const params =
          chain.kind === 'Evm' ? await evmParams(chain, flag) : chain.kind === 'Bitcoin' ? await btcParams(chain, flag) : await solParams(chain);
        log(`flag #${flag.id} (${chain.name}) → request_flag_signature`, JSON.stringify(params));
        const { value } = await call(KEEPER, dep.raid, 'request_flag_signature', { flag_id: flag.id, params }, { gas: 300n * TGAS });
        log(`  signed: expected tx ${value}`);
        // Broadcast right away: a Solana blockhash is only valid for about a minute.
        const fresh = (await view(dep.raid, 'get_flags', { limit: 50 })).find((f) => f.id === flag.id);
        if (fresh?.status !== 'Signed') continue;
        Object.assign(flag, fresh);
      }
      if (flag.status === 'Signed') {
        const hash = await broadcast(chain, flag);
        log(`flag #${flag.id} broadcast on ${chain.name}: ${hash}`);
        await call(KEEPER, dep.raid, 'confirm_broadcast', { flag_id: flag.id, tx_hash: flag.expected_tx_hash }, { gas: 30n * TGAS });
        log(`  confirmed on NEAR`);
      }
    } catch (e) {
      log(`flag #${flag.id} (${chain.name}): ${e.message.slice(0, 300)}`);
      if (flag.status === 'Signed' && stale(e)) {
        log('  signed tx is stale; requesting a fresh signature');
        try {
          const params = chain.kind === 'Evm' ? await evmParams(chain, flag) : chain.kind === 'Bitcoin' ? await btcParams(chain, flag) : await solParams(chain);
          await call(KEEPER, dep.raid, 'request_flag_signature', { flag_id: flag.id, params }, { gas: 300n * TGAS });
        } catch (e2) {
          log(`  re-sign failed: ${e2.message.slice(0, 200)}`);
        }
      }
    }
  }
}

log(`keeper ${KEEPER} watching ${dep.raid}`);
do {
  try {
    await tick();
  } catch (e) {
    log('tick error', e.message);
  }
  if (!ONCE) await sleep(Number(process.env.KEEPER_INTERVAL_MS || 15000));
} while (!ONCE);
