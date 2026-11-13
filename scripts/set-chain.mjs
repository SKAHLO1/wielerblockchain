// Owner tool: re-registers an existing chain with changed fields (e.g. its explorer).
// Usage: node set-chain.mjs <chain-id> '<json-of-fields-to-change>'
import { TGAS, call, deployment, log, view } from './lib.mjs';
const dep = deployment();
const [id, patch] = process.argv.slice(2);
const chain = (await view(dep.raid, 'get_chains')).find((c) => c.id === id);
if (!chain) throw new Error(`no chain ${id}`);
const { gas_reserve, conquest_count, territory_account, ...args } = { ...chain, ...JSON.parse(patch || '{}') };
await call(dep.master, dep.raid, 'add_chain', args, { gas: 50n * TGAS });
log(`updated ${id}:`, JSON.stringify(JSON.parse(patch || '{}')));
