'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import Globe from './Globe';
import { Empty, Panel, useUi } from './ui';
import {
  ART,
  chainArt,
  chainBanner,
  ChainIcon,
  IconArrowRight,
  IconCoins,
  IconCrown,
  IconExternal,
  IconFlag,
  IconFlame,
  IconShield,
  IconStar,
  IconSwap,
  IconSword,
  IconTrophy,
} from './icons';
import { useClock, useGame, useWallet } from '@/lib/providers';
import { CONFIG, fmtCompact, fmtFull, timeAgo, toBig } from '@/lib/near';
import { markersFor, progressPct, short, flagTxUrl } from '@/lib/game';
import type { Activity, Raider } from '@/lib/types';

// ------------------------------------------------------------------ hero

export function EmpireHero() {
  const game = useGame();
  const markers = useMemo(() => markersFor(game.map), [game.map]);
  const lastClosedBurn = useMemo(() => {
    const pts = game.supply;
    if (pts.length < 2) return 0n;
    return toBig(pts[pts.length - 1].burned_total) - toBig(pts[pts.length - 2].burned_total);
  }, [game.supply]);
  return (
    <section className="panel hero">
      <div className="hero-bg" aria-hidden />
      <div className="hero-copy">
        <h2>The WIELER Empire</h2>
        <p className="hero-sub">
          A cross-chain conquest
          <br />
          in real time.
        </p>
        <ul className="hero-stats">
          <li>
            <IconCrown size={34} className="hs-icon" />
            <div>
              <small>Total Supply</small>
              <strong>{fmtFull(game.totalSupply !== '0' ? game.totalSupply : game.initialSupply)}</strong>
              <em>WIELER</em>
            </div>
          </li>
          <li>
            <IconFlame size={34} className="hs-icon" />
            <div>
              <small>Burned Last Conquest</small>
              <strong>{fmtFull(lastClosedBurn)}</strong>
              <em>WIELER</em>
            </div>
          </li>
          <li>
            <IconTrophy size={34} className="hs-icon" />
            <div>
              <small>Active Clans</small>
              <strong>{game.map?.clans ?? 0}</strong>
            </div>
          </li>
        </ul>
        <Link href="/map/" className="btn btn-outline">
          View Full Map <IconArrowRight size={16} />
        </Link>
      </div>
      <div className="hero-globe">
        <Globe markers={markers} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ your stats

export function rankOf(raiders: [string, Raider][], account: string | null) {
  if (!account) return null;
  const sorted = [...raiders].sort((a, b) => (toBig(b[1].total_staked) > toBig(a[1].total_staked) ? 1 : -1));
  const i = sorted.findIndex(([id]) => id === account);
  return i < 0 ? null : i + 1;
}

export function YourStats() {
  const game = useGame();
  const { accountId, signIn } = useWallet();
  const { openStake } = useUi();
  const raider = game.me?.raider;
  const rank = rankOf(game.raiders, accountId);
  const holds = game.map?.chains.some((c) => c.territory?.holders.some((h) => h.account_id === accountId));
  const role = !accountId ? 'Spectator' : holds ? 'Territory Holder' : raider ? 'Raider' : 'Recruit';
  return (
    <section className="panel stats">
      <h2>Your Stats</h2>
      <div className="stats-id">
        <img src={ART.barbarianPortrait} alt="" className="avatar" width={100} height={100} />
        <div>
          <div className="stats-name">
            <span>{accountId ?? 'Not connected'}</span>
            {accountId && (
              <a href={`${CONFIG.explorer}/address/${accountId}`} target="_blank" rel="noreferrer" aria-label="Open in explorer">
                <IconExternal size={18} />
              </a>
            )}
          </div>
          <div className="stats-role">{role}</div>
        </div>
      </div>
      <div className="stats-grid">
        <div>
          <IconCoins size={30} />
          <strong>{fmtCompact(raider?.active_stake ?? '0')}</strong>
          <small>WIELER Staked</small>
        </div>
        <div>
          <IconShield size={30} />
          <strong>{raider?.conquests ?? 0}</strong>
          <small>Conquests</small>
        </div>
        <div>
          <IconStar size={30} />
          <strong>{rank ? `#${rank}` : '—'}</strong>
          <small>Rank</small>
        </div>
      </div>
      <button className="btn btn-primary btn-block btn-lg" onClick={() => (accountId ? openStake() : signIn())}>
        Stake for Next Raid <IconArrowRight size={18} />
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ current raids

export function CurrentRaids() {
  const game = useGame();
  const { openStake } = useUi();
  const chains = game.map?.chains ?? [];
  return (
    <Panel
      title="Current Raids"
      className="raids"
      action={
        <Link href="/staking/" className="view-all">
          View All <IconArrowRight size={15} />
        </Link>
      }
    >
      {chains.length === 0 ? (
        <Empty>No target chains registered yet.</Empty>
      ) : (
        <div className="raid-cards">
          {chains.slice(0, 3).map((c) => {
            const pct = progressPct(c);
            return (
              <div key={c.chain.id} className={`raid-card ${c.territory?.barbarian ? 'barb' : ''}`}>
                <div className="raid-art" style={{ backgroundImage: `url(${chainArt[c.chain.id] ?? chainArt.bitcoin})` }}>
                  {chainBanner[c.chain.id] ? (
                    <img src={chainBanner[c.chain.id]} alt="" className="raid-banner" />
                  ) : (
                    <ChainIcon id={c.chain.id} size={30} />
                  )}
                </div>
                <div className="raid-body">
                  <h3>{c.chain.name}</h3>
                  <small>Target: {fmtCompact(c.target)}</small>
                  <div className="progress-row">
                    <div className="progress">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <b>{Math.round(pct)}%</b>
                  </div>
                  <button className="btn btn-dark btn-block" onClick={() => openStake(c.chain.id)}>
                    Stake Now
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ leaderboard

type Tab = 'Raiders' | 'Clans' | 'Territories';
const RANK_ICONS = [IconCrown, IconSword, IconShield, IconStar, IconFlag];

export function useLeaderboard(tab: Tab) {
  const game = useGame();
  return useMemo(() => {
    if (tab === 'Raiders')
      return [...game.raiders]
        .sort((a, b) => (toBig(b[1].total_staked) > toBig(a[1].total_staked) ? 1 : -1))
        .map(([id, r]) => ({ name: id, value: r.total_staked, sub: `${r.conquests} conquests`, barbarian: id === game.map?.barbarian }));
    if (tab === 'Clans')
      return [...game.clans]
        .sort((a, b) => (toBig(b.total_staked) > toBig(a.total_staked) ? 1 : -1))
        .map((c) => ({ name: c.name, value: c.total_staked, sub: `${c.members} members · ${c.conquests} conquests`, barbarian: false }));
    return (game.map?.chains ?? [])
      .filter((c) => c.territory)
      .sort((a, b) => (toBig(b.territory!.total_stake) > toBig(a.territory!.total_stake) ? 1 : -1))
      .map((c) => ({
        name: `${c.chain.name} · ${c.territory!.barbarian ? 'Barbarian' : c.territory!.clan ?? short(c.territory!.holders[0]?.account_id ?? '')}`,
        value: c.territory!.total_stake,
        sub: `held since epoch ${c.territory!.held_since_epoch}`,
        barbarian: c.territory!.barbarian,
      }));
  }, [tab, game.raiders, game.clans, game.map]);
}

export function LeaderboardCard() {
  const [tab, setTab] = useState<Tab>('Raiders');
  const rows = useLeaderboard(tab).slice(0, 5);
  return (
    <Panel title="Leaderboard" className="leader">
      <div className="tabs" role="tablist">
        {(['Raiders', 'Clans', 'Territories'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>No {tab.toLowerCase()} yet.</Empty>
      ) : (
        <ol className="lb-list">
          {rows.map((r, i) => {
            const Icon = RANK_ICONS[i] ?? IconStar;
            return (
              <li key={r.name} className={i === 2 ? 'third' : ''}>
                <span className="lb-rank">{i + 1}</span>
                <Icon size={20} className={`lb-icon ${i === 0 ? 'gold' : ''} ${r.barbarian ? 'barb' : ''}`} />
                <span className="lb-name" title={r.name}>
                  {r.name}
                </span>
                <span className="lb-val">{fmtCompact(r.value)}</span>
              </li>
            );
          })}
        </ol>
      )}
      <Link href="/leaderboard/" className="btn btn-dark btn-block">
        View Leaderboard <IconArrowRight size={16} />
      </Link>
    </Panel>
  );
}

// ------------------------------------------------------------------ activity

export function activityIcon(kind: string) {
  switch (kind) {
    case 'flag':
    case 'broadcast':
      return <span className="act-icon act-flag"><IconFlag size={22} /></span>;
    case 'burn':
      return <span className="act-icon act-burn"><IconFlame size={26} /></span>;
    case 'transfer':
    case 'defend':
      return <span className="act-icon act-swap"><IconSwap size={24} /></span>;
    case 'clan':
    case 'bounty':
      return <span className="act-icon act-trophy"><IconTrophy size={26} /></span>;
    default:
      return <span className="act-icon act-swap"><IconCoins size={22} /></span>;
  }
}

export function activityLink(a: Activity, flags: ReturnType<typeof useGame>['flags'], chains: ReturnType<typeof useGame>['map']) {
  if (a.flag_id !== null && a.flag_id !== undefined) {
    const f = flags.find((x) => x.id === a.flag_id);
    const chain = chains?.chains.find((c) => c.chain.id === f?.chain);
    if (f?.tx_hash && chain) return flagTxUrl(chain.chain.explorer_tx_url, f.tx_hash);
  }
  return `${CONFIG.explorer}/address/${CONFIG.raidContract}`;
}

export function RecentActivity({ limit = 4 }: { limit?: number }) {
  useClock(15000);
  const game = useGame();
  const items = game.activity.slice(0, limit);
  return (
    <Panel
      title="Recent Activity"
      className="activity"
      action={
        <Link href="/explorer/" className="view-all">
          View All <IconArrowRight size={15} />
        </Link>
      }
    >
      {items.length === 0 ? (
        <Empty>No on-chain activity yet.</Empty>
      ) : (
        <ul className="act-list">
          {items.map((a, i) => (
            <li key={i}>
              {activityIcon(a.kind)}
              <span className="act-text">{a.text}</span>
              <span className="act-meta">
                {timeAgo(Number(a.ts_ms), game.now())}
                <a href={activityLink(a, game.flags, game.map)} target="_blank" rel="noreferrer" aria-label="Open in explorer">
                  <IconExternal size={13} />
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ barbarian banner

export function BarbarianBanner() {
  return (
    <section className="panel banner">
      <div className="banner-bg" aria-hidden />
      <img src={ART.barbarianFull} alt="The Barbarian" className="banner-portrait" />
      <div className="banner-copy">
        <h2>Meet the Barbarian</h2>
        <p>The AI raider that never sleeps. Always staking. Always challenging.</p>
      </div>
      <Link href="/docs/#barbarian" className="btn btn-outline btn-pill">
        Learn More <IconArrowRight size={16} />
      </Link>
    </section>
  );
}
