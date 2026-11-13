import type { Chain } from './types';

export const SEPOLIA_RPC = process.env.NEXT_PUBLIC_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
export const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';

function esploraApi(chain: Chain) {
  // Esplora API next to the explorer: https://blockstream.info/testnet/tx/ -> /testnet/api
  return chain.explorer_tx_url.replace(/\/tx\/?$/, '/api');
}

/** Native gas balance of a chain's derived WIELER wallet, as [display string, low?]. */
export async function foreignBalance(chain: Chain): Promise<{ text: string; low: boolean }> {
  try {
    if (chain.kind === 'Bitcoin') {
      const r = await fetch(`${esploraApi(chain)}/address/${chain.derived_address}`);
      const j = await r.json();
      const sats =
        j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum + j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum;
      return { text: `${(sats / 1e8).toFixed(6)} tBTC`, low: sats < 2_000 };
    }
    if (chain.kind === 'Evm') {
      const r = await fetch(SEPOLIA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [chain.derived_address, 'latest'] }),
      });
      const j = await r.json();
      const wei = BigInt(j.result);
      return { text: `${(Number(wei / 10n ** 12n) / 1e6).toFixed(5)} ETH`, low: wei < 10n ** 14n };
    }
    const r = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [chain.derived_address] }),
    });
    const j = await r.json();
    const lamports = j.result.value as number;
    return { text: `${(lamports / 1e9).toFixed(4)} SOL`, low: lamports < 10_000 };
  } catch {
    return { text: 'unavailable', low: false };
  }
}
