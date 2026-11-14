import deployment from '@/config/deployment.json';

export const CONFIG = {
  networkId: (process.env.NEXT_PUBLIC_NETWORK_ID || deployment.networkId) as 'testnet' | 'mainnet',
  nodeUrl: process.env.NEXT_PUBLIC_NODE_URL || deployment.nodeUrl,
  tokenContract: process.env.NEXT_PUBLIC_TOKEN_CONTRACT || deployment.tokenContract,
  raidContract: process.env.NEXT_PUBLIC_RAID_CONTRACT || deployment.raidContract,
  barbarian: process.env.NEXT_PUBLIC_BARBARIAN || deployment.barbarian,
  explorer: deployment.explorer,
};

export const isDeployed = () => Boolean(CONFIG.tokenContract && CONFIG.raidContract);

export const ONE_WIELER = 10n ** 18n;
export const TGAS = 1_000_000_000_000n;

function b64(s: string) {
  if (typeof window === 'undefined') return Buffer.from(s).toString('base64');
  return btoa(unescape(encodeURIComponent(s)));
}

function decodeResult(bytes: number[]) {
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  return text ? JSON.parse(text) : null;
}

/** Public RPCs tried in order when the configured one fails. Free endpoints rate-limit
 * per IP, and a throttled response usually lacks CORS headers, so the browser only
 * reports "Failed to fetch". Falling back keeps the site readable for every visitor. */
const FALLBACK_RPCS: Record<string, string[]> = {
  testnet: ['https://near-testnet.drpc.org', 'https://rpc.testnet.near.org'],
  mainnet: ['https://near.drpc.org', 'https://rpc.mainnet.near.org'],
};
const RPCS = [...new Set([CONFIG.nodeUrl, ...(FALLBACK_RPCS[CONFIG.networkId] ?? [])])];
/** Index of the endpoint that last answered; later calls start there. */
let rpcIndex = 0;

async function rpcQuery(params: object) {
  let lastError: unknown;
  for (let i = 0; i < RPCS.length; i++) {
    const idx = (rpcIndex + i) % RPCS.length;
    try {
      const res = await fetch(RPCS[idx], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'wieler', method: 'query', params }),
      });
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const json = await res.json();
      rpcIndex = idx;
      return json;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export async function view<T = unknown>(contract: string, method: string, args: object = {}): Promise<T> {
  const json = await rpcQuery({
    request_type: 'call_function',
    finality: 'optimistic',
    account_id: contract,
    method_name: method,
    args_base64: b64(JSON.stringify(args)),
  });
  if (json.error) throw new Error(json.error?.cause?.name || json.error.message || 'RPC error');
  if (json.result?.error) throw new Error(json.result.error);
  return decodeResult(json.result.result) as T;
}

// ------------------------------------------------------------------ formatting

export function toBig(v: string | number | bigint | undefined | null): bigint {
  if (v === undefined || v === null || v === '') return 0n;
  return BigInt(v);
}

/** 18-decimal amount -> number of whole WIELER (float). */
export function toWhole(v: string | bigint | undefined | null): number {
  const b = toBig(v as string);
  return Number(b / 10n ** 12n) / 1e6;
}

export function fmtCompact(v: string | bigint | number | undefined | null, digits = 1): string {
  const n = typeof v === 'number' ? v : toWhole(v as string);
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(digits === 1 ? 2 : digits) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(digits) + 'K';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtFull(v: string | bigint | undefined | null): string {
  return Math.floor(toWhole(v)).toLocaleString('en-US');
}

export function parseWieler(input: string): bigint {
  const clean = input.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error('Enter a number');
  const [i, f = ''] = clean.split('.');
  return BigInt(i) * ONE_WIELER + BigInt((f + '0'.repeat(18)).slice(0, 18));
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, '0')).join(':');
}

export const accountUrl = (id: string) => `${CONFIG.explorer}/address/${id}`;
export const txUrl = (hash: string) => `${CONFIG.explorer}/txns/${hash}`;
