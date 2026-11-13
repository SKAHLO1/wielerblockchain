import type { GlobeMarker } from '@/components/Globe';
import { CONFIG, toBig } from './near';
import type { MapChain, MapView, Territory } from './types';

const POS: Record<string, { lonlat: [number, number]; label: [number, number] }> = {
  bitcoin: { lonlat: [-98, 41], label: [-40, -118] },
  ethereum: { lonlat: [26, 50], label: [40, -104] },
  solana: { lonlat: [-58, -12], label: [-172, -2] },
  near: { lonlat: [40, 2], label: [-30, 26] },
};

export function territoryLabel(t: Territory | null | undefined, barbarian?: string | null): string {
  if (!t) return 'Unclaimed';
  if (t.barbarian) return 'Barbarian Territory';
  if (t.clan) return `${t.clan} Territory`;
  const top = t.holders[0]?.account_id;
  if (barbarian && top === barbarian) return 'Barbarian Territory';
  return top ? `Held by ${short(top)}` : 'Wieler Territory';
}

export function short(account: string, max = 18) {
  if (account.length <= max) return account;
  const parts = account.split('.');
  if (parts[0].length <= max - 4) return `${parts[0]}.…`;
  return account.slice(0, max - 1) + '…';
}

export function chainStatus(c: MapChain, map: MapView): { text: string; tone: GlobeMarker['tone'] } {
  const underAttack = toBig(c.epoch_stake) > 0n;
  if (c.territory?.barbarian) return { text: underAttack ? 'Barbarian · Under Attack' : 'Barbarian Territory', tone: 'barbarian' };
  if (c.territory && underAttack) return { text: 'Under Attack', tone: 'attack' };
  if (c.territory) return { text: territoryLabel(c.territory, map.barbarian), tone: 'held' };
  if (underAttack) return { text: 'Under Attack', tone: 'attack' };
  return { text: 'Unclaimed', tone: 'idle' };
}

export function markersFor(map: MapView | null): GlobeMarker[] {
  const out: GlobeMarker[] = [];
  const known = map?.chains ?? [];
  const defaults = [
    { id: 'bitcoin', name: 'Bitcoin' },
    { id: 'ethereum', name: 'Ethereum' },
    { id: 'solana', name: 'Solana' },
  ];
  const list = known.length ? known.map((c) => ({ id: c.chain.id, name: c.chain.name, c })) : defaults.map((d) => ({ ...d, c: null }));
  for (const item of list) {
    const pos = POS[item.id] ?? { lonlat: [0, 0] as [number, number], label: [20, -30] as [number, number] };
    const st = item.c && map ? chainStatus(item.c, map) : { text: 'Unclaimed', tone: 'idle' as const };
    out.push({ id: item.id, name: item.name, status: st.text, tone: st.tone, lonlat: pos.lonlat, label: pos.label });
  }
  out.push({ id: 'near', name: 'NEAR', status: 'Wieler Territory', tone: 'home', ...POS.near });
  return out;
}

export function progressPct(c: MapChain): number {
  const target = toBig(c.target);
  if (target === 0n) return 0;
  const pct = Number((toBig(c.epoch_stake) * 1000n) / target) / 10;
  return Math.min(100, pct);
}

export function nearAccountUrl(id: string) {
  return `${CONFIG.explorer}/address/${id}`;
}

/** Explorer link for a chain's derived WIELER wallet, built from its tx explorer prefix. */
export function addressUrl(chain: { explorer_tx_url: string; derived_address: string }) {
  const [base, query] = chain.explorer_tx_url.split('?');
  const url = base.replace(/\/tx\/?$/, '/address/') + chain.derived_address;
  return query ? `${url}?${query}` : url;
}

export function flagTxUrl(explorerTxUrl: string, hash: string) {
  const [base, query] = explorerTxUrl.split('?');
  return query ? `${base}${hash}?${query}` : `${base}${hash}`;
}
