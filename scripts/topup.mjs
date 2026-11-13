// Sends NEAR from MASTER_ACCOUNT to the demo accounts and the Barbarian for gas.
// Usage: node topup.mjs [amount-in-NEAR, default 0.4]
import { NEAR, account, deployment, log } from './lib.mjs';

const dep = deployment();
const amt = BigInt(Math.round(Number(process.argv[2] || 0.4) * 1000)) * (NEAR / 1000n);
const master = await account(dep.master);
for (const k of ['alice', 'bob', 'carol', 'barbarian']) {
  await master.sendMoney(dep[k], amt);
  log(`sent ${Number(amt / (NEAR / 1000n)) / 1000} NEAR to ${dep[k]}`);
}
