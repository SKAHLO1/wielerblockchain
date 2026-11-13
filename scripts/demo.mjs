// Runs the PRD demo moves with the alice / bob / carol test accounts.
//   node demo.mjs epoch1   alice + bob stake behind Bitcoin, carol behind Ethereum (Sepolia)
//   node demo.mjs epoch2   withdraws epoch-1 stakes, then carol gathers more stake and challenges Bitcoin
//   node demo.mjs status   prints the map, flags and supply
//   node demo.mjs unstake  withdraws every closed stake for the three accounts
import { ONE_WIELER, TGAS, call, deployment, fmt, log, view } from './lib.mjs';

const dep = deployment();
const cmd = process.argv[2] || 'status';

async function stake(who, chain, whole) {
  const id = dep[who];
  const amount = BigInt(whole) * ONE_WIELER;
  const bal = BigInt(await view(dep.token, 'ft_balance_of', { account_id: id }));
  if (bal < amount) {
    try {
      await call(id, dep.token, 'faucet', {}, { gas: 30n * TGAS });
      log(`${who} claimed from the faucet`);
    } catch (e) {
      log(`${who} faucet: ${e.message.slice(0, 120)}`);
    }
  }
  await call(id, dep.token, 'ft_transfer_call', { receiver_id: dep.raid, amount: amount.toString(), msg: JSON.stringify({ chain }) }, { deposit: 1n, gas: 150n * TGAS });
  log(`${who} staked ${whole} WIELER behind ${chain}`);
}

async function withdrawAll() {
  for (const who of ['alice', 'bob', 'carol']) {
    const stakes = await view(dep.raid, 'get_account_stakes', { account_id: dep[who] });
    for (const s of stakes.filter((s) => !s.settled && s.claimable)) {
      await call(dep[who], dep.raid, 'unstake', { epoch: s.epoch, chain: s.chain }, { gas: 100n * TGAS });
      log(`${who} withdrew epoch ${s.epoch} ${s.chain}: ${fmt(s.claimable)}`);
    }
  }
}

async function status() {
  const map = await view(dep.raid, 'get_map');
  const supply = await view(dep.token, 'ft_total_supply');
  const left = Number(BigInt(map.epoch.end_ns) / 1_000_000n) - Number(map.now_ms);
  console.log(`Epoch ${map.epoch.id} · ${left > 0 ? Math.round(left / 1000) + 's left' : 'ended'} · supply ${fmt(supply)} · burned ${fmt(map.total_burned)}`);
  for (const c of map.chains) {
    const t = c.territory;
    console.log(
      `  ${c.chain.name.padEnd(9)} stake ${fmt(c.epoch_stake).padStart(12)}  ${t ? `held by ${t.barbarian ? 'BARBARIAN ' : ''}${t.holders.map((h) => h.account_id).join(',')}` : 'unclaimed'}`,
    );
  }
  const flags = await view(dep.raid, 'get_flags', { limit: 10 });
  for (const f of flags) console.log(`  flag #${f.id} ${f.chain} E${f.epoch} ${f.status} ${f.tx_hash ?? ''}  "${f.memo}"`);
}

if (cmd === 'epoch1') {
  await stake('alice', 'bitcoin', 12000);
  await stake('bob', 'bitcoin', 8000);
  await stake('carol', 'ethereum', 9000);
} else if (cmd === 'epoch2') {
  await withdrawAll();
  await stake('carol', 'bitcoin', 24000);
  await stake('alice', 'bitcoin', 3000);
} else if (cmd === 'unstake') {
  await withdrawAll();
}
await status();
