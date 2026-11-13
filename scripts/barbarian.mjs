// The Barbarian: an AI raider that plays against everyone.
//
// Published strategy (deterministic, so anyone can check its moves against this file):
//   1. Once per epoch, pick exactly one target chain:
//        - never a chain it already holds;
//        - prefer the chain with the LEAST defending stake (unheld chains count as 0);
//        - ties go to the chain held the longest (lowest held_since_epoch), then by name.
//   2. Stake min(25% of its war chest, the contract cap). The cap is
//      max(40% of the other raiders' stake this epoch, 250K WIELER).
//   3. Withdraw every stake from closed epochs, so winnings return to the war chest.
//
// The PRD targets a Shade Agent in a TEE (Phala Cloud). This is the PRD's fallback: the same
// agent run locally with the Barbarian account's key. Usage: node barbarian.mjs [--once]
import { ONE_WIELER, TGAS, call, deployment, fmt, log, sleep, view } from './lib.mjs';

const dep = deployment();
const ME = dep.barbarian;
const ONCE = process.argv.includes('--once');

function pickTarget(map) {
  const candidates = map.chains
    .filter((c) => !(c.territory && c.territory.holders.some((h) => h.account_id === ME)))
    .map((c) => ({
      id: c.chain.id,
      defending: c.territory ? BigInt(c.territory.total_stake) : 0n,
      heldSince: c.territory ? c.territory.held_since_epoch : Number.MAX_SAFE_INTEGER,
    }));
  candidates.sort((a, b) =>
    a.defending !== b.defending ? (a.defending < b.defending ? -1 : 1) : a.heldSince - b.heldSince || a.id.localeCompare(b.id),
  );
  return candidates[0]?.id ?? null;
}

async function tick() {
  const [map, config] = await Promise.all([view(dep.raid, 'get_map'), view(dep.raid, 'get_config')]);
  const now = Number(map.now_ms);
  const end = Number(BigInt(map.epoch.end_ns) / 1_000_000n);

  // Withdraw closed stakes.
  const stakes = await view(dep.raid, 'get_account_stakes', { account_id: ME });
  for (const s of stakes) {
    if (!s.settled && s.claimable) {
      await call(ME, dep.raid, 'unstake', { epoch: s.epoch, chain: s.chain }, { gas: 100n * TGAS });
      log(`withdrew epoch ${s.epoch} ${s.chain}: ${fmt(s.claimable)} WIELER`);
    }
  }

  if (now >= end) return; // waiting for a keeper
  const epoch = map.epoch.id;
  if (stakes.some((s) => s.epoch === epoch)) return; // already raiding this epoch

  const target = pickTarget(map);
  if (!target) return log('nothing to raid');
  const chest = BigInt(await view(dep.token, 'ft_balance_of', { account_id: ME }));
  const others = BigInt(map.epoch.total);
  const cap = (others * BigInt(config.barbarian_epoch_share_bps)) / 10000n;
  const floor = BigInt(config.barbarian_floor);
  const allowed = cap > floor ? cap : floor;
  let amount = chest / 4n;
  if (amount > allowed) amount = allowed;
  if (amount < ONE_WIELER) return log('war chest is empty');
  log(`epoch ${epoch}: raiding ${target} with ${fmt(amount)} WIELER (chest ${fmt(chest)})`);
  await call(
    ME,
    dep.token,
    'ft_transfer_call',
    { receiver_id: dep.raid, amount: amount.toString(), msg: JSON.stringify({ chain: target }) },
    { deposit: 1n, gas: 150n * TGAS },
  );
}

log(`Barbarian ${ME} awakens`);
do {
  try {
    await tick();
  } catch (e) {
    log('error', e.message.slice(0, 300));
  }
  if (!ONCE) await sleep(Number(process.env.BARBARIAN_INTERVAL_MS || 20000));
} while (!ONCE);
