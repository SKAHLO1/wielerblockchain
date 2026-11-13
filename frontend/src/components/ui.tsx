'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useGame, useWallet } from '@/lib/providers';
import { CONFIG, fmtCompact, fmtFull, parseWieler, TGAS, toBig } from '@/lib/near';
import { ChainIcon, IconClose } from './icons';

// ====================================================================== toasts

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err' | 'info';
}

interface UiCtx {
  toast: (text: string, kind?: Toast['kind']) => void;
  openStake: (chain?: string) => void;
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
}

const Ctx = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stakeChain, setStakeChain] = useState<string | null>(null);
  const { refresh } = useGame();

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      try {
        toast(`${label}…`, 'info');
        await fn();
        toast(`${label}: done`, 'ok');
        setTimeout(refresh, 1500);
        return true;
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        toast(`${label} failed: ${msg.slice(0, 160)}`, 'err');
        return false;
      }
    },
    [toast, refresh],
  );

  const openStake = useCallback((chain?: string) => setStakeChain(chain ?? ''), []);
  const value = useMemo(() => ({ toast, openStake, run }), [toast, openStake, run]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {stakeChain !== null && <StakeModal initialChain={stakeChain} onClose={() => setStakeChain(null)} />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useUi() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUi outside provider');
  return c;
}

// ====================================================================== stake modal

function StakeModal({ initialChain, onClose }: { initialChain: string; onClose: () => void }) {
  const game = useGame();
  const { accountId, signIn, call } = useWallet();
  const { run } = useUi();
  const chains = game.map?.chains ?? [];
  const [chain, setChain] = useState(initialChain || chains[0]?.chain.id || 'bitcoin');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const balance = toBig(game.me?.balance);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selected = chains.find((c) => c.chain.id === chain);
  const isHolder = selected?.territory?.holders.some((h) => h.account_id === accountId);

  async function submit() {
    setErr(null);
    let raw: bigint;
    try {
      raw = parseWieler(amount);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    if (raw <= 0n) return setErr('Amount must be positive');
    if (raw > balance) return setErr('Not enough WIELER. Use the faucet on the Staking page.');
    const ok = await run(`Stake ${fmtCompact(raw)} WIELER on ${selected?.chain.name ?? chain}`, () =>
      call({
        receiverId: CONFIG.tokenContract,
        method: 'ft_transfer_call',
        args: { receiver_id: CONFIG.raidContract, amount: raw.toString(), msg: JSON.stringify({ chain }) },
        deposit: '1',
        gas: 150n * TGAS,
      }),
    );
    if (ok) onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-label="Stake WIELER" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Stake for the next raid</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        {!accountId ? (
          <div className="modal-body">
            <p className="muted">Connect a NEAR testnet wallet to stake WIELER behind a chain.</p>
            <button className="btn btn-primary btn-block" onClick={signIn}>
              Connect Wallet
            </button>
          </div>
        ) : (
          <div className="modal-body">
            <label className="field-label">Target chain</label>
            <div className="chain-pick">
              {chains.map((c) => (
                <button
                  key={c.chain.id}
                  className={`chain-pick-item ${c.chain.id === chain ? 'active' : ''}`}
                  onClick={() => setChain(c.chain.id)}
                >
                  <ChainIcon id={c.chain.id} size={22} />
                  <span>{c.chain.name}</span>
                </button>
              ))}
            </div>
            {selected && (
              <p className="muted small">
                {selected.territory
                  ? isHolder
                    ? 'You hold this territory: your stake defends it.'
                    : 'Held territory: out-stake its holders to take it (5% burn on win).'
                  : 'Unheld chain: if it is the most-staked chain this epoch, it is conquered (10% burn on win).'}{' '}
                Every stake pays a 2% raid fee.
              </p>
            )}
            <label className="field-label" htmlFor="stake-amt">
              Amount <span className="muted">· balance {fmtFull(game.me?.balance)} WIELER</span>
            </label>
            <div className="input-row">
              <input
                id="stake-amt"
                className="input"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <button className="btn btn-ghost" onClick={() => setAmount((Number(balance / 10n ** 18n)).toString())}>
                Max
              </button>
            </div>
            {err && <p className="error small">{err}</p>}
            <button className="btn btn-primary btn-block" onClick={submit}>
              Stake WIELER
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PageHero({
  title,
  sub,
  art,
  icon,
}: {
  title: string;
  sub: React.ReactNode;
  art: string;
  icon: string;
}) {
  return (
    <section className="panel page-hero">
      <div className="page-hero-art" style={{ backgroundImage: `url(${art})` }} />
      <img src={icon} alt="" className="page-hero-icon" />
      <div className="page-hero-copy">
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
    </section>
  );
}

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
