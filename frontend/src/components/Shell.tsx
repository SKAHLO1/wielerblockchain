'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DataProvider, useClock, useGame, useWallet, WalletProvider } from '@/lib/providers';
import { countdown, fmtCompact, toWhole, timeAgo, CONFIG, TGAS } from '@/lib/near';
import { UiProvider, useUi } from './ui';
import {
  IconBell,
  IconBook,
  IconChevronDown,
  IconClock,
  IconCoins,
  IconExternal,
  IconGift,
  IconGlobe,
  IconHome,
  IconMenu,
  IconTrophy,
  IconUser,
  IconWallet,
} from './icons';

const NAV = [
  { href: '/', label: 'Home', icon: IconHome },
  { href: '/map/', label: 'Map', icon: IconGlobe },
  { href: '/staking/', label: 'Staking', icon: IconCoins },
  { href: '/leaderboard/', label: 'Leaderboard', icon: IconTrophy },
  { href: '/rewards/', label: 'Rewards', icon: IconGift },
  { href: '/explorer/', label: 'Explorer', icon: IconExternal },
  { href: '/docs/', label: 'Docs', icon: IconBook },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <DataProvider>
        <UiProvider>
          <Frame>{children}</Frame>
        </UiProvider>
      </DataProvider>
    </WalletProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="app">
      <Sidebar open={open} />
      {open && <div className="app-sidebar-scrim" onClick={() => setOpen(false)} />}
      <main className="main">
        <Header open={open} onMenu={() => setOpen((o) => !o)} />
        <DeployNotice />
        {children}
      </main>
    </div>
  );
}

function DeployNotice() {
  const game = useGame();
  if (game.deployed && !game.error) return null;
  return (
    <div className="notice">
      {game.deployed ? `Could not reach the NEAR testnet RPC: ${game.error}` : game.error}
    </div>
  );
}

function Sidebar({ open }: { open: boolean }) {
  const path = usePathname();
  const { accountId, signIn, signOut } = useWallet();
  return (
    <aside className={`app-sidebar ${open ? 'open' : ''}`}>
      <Link href="/" className="brand" aria-label="WIELER home">
        <img src="/images/logo.svg" alt="" width={86} height={58} />
        <span>WIELER</span>
      </Link>
      <nav className="nav">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? path === '/' : path?.startsWith(href.replace(/\/$/, ''));
          return (
            <Link key={href} href={href} className={`nav-item ${active ? 'active' : ''}`}>
              <Icon size={24} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <SupplyWidget />
      {accountId ? (
        <button className="connect-btn" onClick={signOut} title="Sign out">
          <IconWallet size={22} />
          <span>Disconnect</span>
        </button>
      ) : (
        <button className="connect-btn" onClick={signIn}>
          <IconWallet size={22} />
          <span>Connect Wallet</span>
        </button>
      )}
      <div className="app-sidebar-mountains" aria-hidden />
    </aside>
  );
}

/** Same slot as the mockup's price card. WIELER is testnet-only with no market,
 * so it shows circulating supply and the change from burns, with a supply sparkline. */
function SupplyWidget() {
  const game = useGame();
  const supply = toWhole(game.totalSupply) || 1_000_000_000;
  const initial = 1_000_000_000;
  const change = ((supply - initial) / initial) * 100;
  const pts = game.supply.length ? game.supply.map((p) => initial - toWhole(p.burned_total)) : [initial, initial];
  const series = pts.length === 1 ? [pts[0], pts[0]] : pts;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const d = series
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (series.length - 1)) * 160).toFixed(1)},${(6 + (1 - (v - min) / span) * 38).toFixed(1)}`)
    .join(' ');
  return (
    <div className="price-card">
      <div className="price-head">
        <img src="/images/art/icon-coin.webp" alt="" width={30} height={30} className="price-logo" />
        <span>WIELER</span>
      </div>
      <div className="price-row">
        <strong>{fmtCompact(supply)}</strong>
        <span className={change < 0 ? 'down' : 'flat'}>
          {change < 0 ? '▼' : '•'} {change.toFixed(3)}%
        </span>
      </div>
      <div className="price-sub">Circulating supply · testnet</div>
      <svg viewBox="0 0 160 50" className="spark" preserveAspectRatio="none" aria-label="Supply history">
        <path d={d} fill="none" stroke="#4f8dff" strokeWidth="2" />
      </svg>
    </div>
  );
}

function Header({ open, onMenu }: { open: boolean; onMenu: () => void }) {
  useClock();
  const game = useGame();
  const { accountId, signIn, signOut, call } = useWallet();
  const { run } = useUi();
  const [menu, setMenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [seen, setSeen] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const epoch = game.map?.epoch;
  const remaining = epoch ? Number(BigInt(epoch.end_ns) / 1_000_000n) - game.now() : 0;
  const ended = epoch && remaining <= 0;
  const latest = game.activity[0] ? Number(game.activity[0].ts_ms) : 0;
  const unread = game.activity.filter((a) => Number(a.ts_ms) > seen).length;

  useEffect(() => {
    try {
      setSeen(Number(localStorage.getItem('wieler.seen') || 0));
    } catch {}
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenu(false);
        setBell(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function openBell() {
    setBell((b) => !b);
    setMenu(false);
    setSeen(latest);
    try {
      localStorage.setItem('wieler.seen', String(latest));
    } catch {}
  }

  return (
    <header className="header">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Menu" aria-expanded={open}>
        <IconMenu />
      </button>
      <div className="hero-title">
        <h1>Stake. Raid. Conquer.</h1>
        <p>A NEAR memecoin with real conquests across chains.</p>
      </div>
      <div className="header-right" ref={ref}>
        <div className="epoch-box">
          <IconClock size={30} />
          <div>
            <small>
              Epoch {epoch?.id ?? '—'} · {ended ? 'Ended' : 'Ends in'}
            </small>
            {ended ? (
              <button
                className="close-epoch"
                onClick={() =>
                  run('Close epoch', () => call({ receiverId: CONFIG.raidContract, method: 'close_epoch', gas: 300n * TGAS }))
                }
              >
                Close epoch
              </button>
            ) : (
              <strong>{epoch ? countdown(remaining) : '--:--:--'}</strong>
            )}
          </div>
        </div>
        <span className="header-sep" />
        <button className="icon-btn bell" onClick={openBell} aria-label="Notifications">
          <IconBell size={24} />
          {unread > 0 && <span className="dot" />}
        </button>
        {bell && (
          <div className="dropdown bell-menu">
            <h4>Latest on-chain activity</h4>
            {game.activity.slice(0, 8).map((a, i) => (
              <div key={i} className="dropdown-row">
                <span>{a.text}</span>
                <small>{timeAgo(Number(a.ts_ms), game.now())}</small>
              </div>
            ))}
            {!game.activity.length && <p className="muted small">No activity yet.</p>}
          </div>
        )}
        {accountId ? (
          <button className="account-btn" onClick={() => (setMenu((m) => !m), setBell(false))}>
            <span className="account-avatar">
              <IconUser size={20} />
            </span>
            <span className="account-name">{accountId}</span>
            <IconChevronDown size={18} />
          </button>
        ) : (
          <button className="account-btn" onClick={signIn}>
            <span className="account-avatar">
              <IconUser size={20} />
            </span>
            <span className="account-name">Connect</span>
            <IconChevronDown size={18} />
          </button>
        )}
        {menu && accountId && (
          <div className="dropdown account-menu">
            <div className="dropdown-row">
              <span>Balance</span>
              <strong>{fmtCompact(game.me?.balance)} WIELER</strong>
            </div>
            <div className="dropdown-row">
              <span>Staked</span>
              <strong>{fmtCompact(game.me?.raider?.active_stake)} WIELER</strong>
            </div>
            <a className="dropdown-link" href={`${CONFIG.explorer}/address/${accountId}`} target="_blank" rel="noreferrer">
              View on NearBlocks <IconExternal size={14} />
            </a>
            <button className="dropdown-link" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
