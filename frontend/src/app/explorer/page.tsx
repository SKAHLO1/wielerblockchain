'use client';

import { useEffect, useState } from 'react';
import { activityIcon } from '@/components/home';
import { ChainIcon, IconExternal, ART } from '@/components/icons';
import { Empty, Panel, PageHero } from '@/components/ui';
import { flagTxUrl } from '@/lib/game';
import { CONFIG, fmtCompact, fmtFull, timeAgo, toWhole, view } from '@/lib/near';
import { useGame } from '@/lib/providers';
import type { Epoch, FlagStatus } from '@/lib/types';

const STATUS: Record<FlagStatus, { label: string; cls: string }> = {
  AwaitingTx: { label: 'Awaiting broadcaster', cls: 'chip-grey' },
  Signing: { label: 'MPC signing', cls: 'chip-amber' },
  Signed: { label: 'Signed', cls: '' },
  Broadcast: { label: 'On-chain', cls: 'chip-green' },
  Failed: { label: 'Signing failed', cls: 'chip-red' },
};

function SupplyChart() {
  const game = useGame();
  const initial = 1_000_000_000;
  const pts = game.supply.map((p) => ({ epoch: p.epoch, v: initial - toWhole(p.burned_total), chain: p.chain }));
  if (pts.length === 0) return <Empty>No supply history yet.</Empty>;
  const series = [...pts, { epoch: game.map?.epoch.id ?? pts[pts.length - 1].epoch + 1, v: pts[pts.length - 1].v, chain: null }];
  const W = 800;
  const H = 240;
  const pad = { l: 70, r: 20, t: 16, b: 30 };
  const min = Math.min(...series.map((s) => s.v));
  const max = initial;
  const span = Math.max(max - min, 1);
  const lo = min - span * 0.15;
  const hi = max + span * 0.05;
  const maxE = Math.max(series[series.length - 1].epoch, 1);
  const x = (e: number) => pad.l + (e / maxE) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  let d = `M${x(series[0].epoch)},${y(series[0].v)}`;
  for (let i = 1; i < series.length; i++) d += ` H${x(series[i].epoch)} V${y(series[i].v)}`;
  const ticks = [hi, (hi + lo) / 2, lo];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="WIELER supply by epoch">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(98,146,255,0.15)" />
          <text x={pad.l - 8} y={y(t) + 4} fill="#9fb0d8" fontSize="11" textAnchor="end">
            {fmtCompact(t, 3)}
          </text>
        </g>
      ))}
      <path d={`${d} V${H - pad.b} H${x(series[0].epoch)} Z`} fill="rgba(59,130,246,0.12)" />
      <path d={d} fill="none" stroke="#4f8dff" strokeWidth="2.5" />
      {pts.slice(1).map((p) => (
        <g key={p.epoch}>
          <circle cx={x(p.epoch)} cy={y(p.v)} r="4" fill="#ff5a3c" />
          <text x={x(p.epoch)} y={y(p.v) + 18} fill="#ffb4a3" fontSize="10.5" textAnchor="middle">
            E{p.epoch} {p.chain}
          </text>
        </g>
      ))}
      <text x={W - pad.r} y={H - 8} fill="#9fb0d8" fontSize="11" textAnchor="end">
        epoch
      </text>
    </svg>
  );
}

function EpochHistory() {
  const game = useGame();
  const current = game.map?.epoch.id ?? 0;
  const [epochs, setEpochs] = useState<Epoch[]>([]);
  useEffect(() => {
    if (!current || !CONFIG.raidContract) return;
    const ids = Array.from({ length: Math.min(12, current - 1) }, (_, i) => current - 1 - i);
    Promise.all(ids.map((id) => view<Epoch | null>(CONFIG.raidContract, 'get_epoch', { id })))
      .then((r) => setEpochs(r.filter(Boolean) as Epoch[]))
      .catch(() => {});
  }, [current]);
  if (!epochs.length) return <Empty>No closed epochs yet.</Empty>;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Epoch</th>
            <th>Result</th>
            <th>Chain</th>
            <th className="num">Total stake</th>
            <th className="num">Burned</th>
            <th>Keeper</th>
          </tr>
        </thead>
        <tbody>
          {epochs.map((e) => (
            <tr key={e.id}>
              <td>#{e.id}</td>
              <td>
                <span
                  className={`chip ${
                    e.outcome?.kind === 'Defended' ? '' : e.outcome?.kind === 'Empty' ? 'chip-grey' : e.outcome?.barbarian_won ? 'chip-red' : 'chip-green'
                  }`}
                >
                  {e.outcome?.kind}
                  {e.outcome?.barbarian_won ? ' · Barbarian' : ''}
                </span>
              </td>
              <td>{e.outcome?.chain ?? '—'}</td>
              <td className="num">{fmtCompact(e.total)}</td>
              <td className="num">{fmtCompact(e.outcome?.burned ?? '0')}</td>
              <td className="mono">{e.outcome?.keeper}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ExplorerPage() {
  const game = useGame();
  const chainOf = (id: string) => game.map?.chains.find((c) => c.chain.id === id)?.chain;
  return (
    <div className="page">
      <PageHero title="Explorer" sub="Every epoch, burn and flag the raid contract has recorded on chain." art={ART.keep} icon={ART.coin} />
      <div className="grid-3">
        <Panel className="stat-tile">
          <small>Circulating supply</small>
          <strong>{fmtFull(game.totalSupply)}</strong>
        </Panel>
        <Panel className="stat-tile">
          <small>Burned through conquests</small>
          <strong>{fmtFull(game.map?.total_burned)}</strong>
        </Panel>
        <Panel className="stat-tile">
          <small>Flags planted</small>
          <strong>{game.map?.flags ?? 0}</strong>
        </Panel>
      </div>
      <Panel title="Supply history">
        <SupplyChart />
      </Panel>
      <Panel title="Flag wall">
        {game.flags.length === 0 ? (
          <Empty>No flags yet. The first conquest plants one.</Empty>
        ) : (
          <div className="flag-wall">
            {game.flags.map((f) => {
              const chain = chainOf(f.chain);
              const st = STATUS[f.status];
              return (
                <div key={f.id} className={`flag-card ${f.barbarian ? 'barb' : ''}`}>
                  <div className="chain-row" style={{ justifyContent: 'space-between' }}>
                    <span className="chain-row">
                      <ChainIcon id={f.chain} size={26} />
                      <b>
                        Flag #{f.id} · {chain?.name ?? f.chain}
                      </b>
                    </span>
                    <span className={`chip ${st.cls}`}>{st.label}</span>
                  </div>
                  <small className="muted">
                    Epoch {f.epoch} · {timeAgo(Number(f.created_ms), game.now())}
                    {f.barbarian ? ' · Barbarian flag' : ''}
                  </small>
                  <div className="names">
                    {f.names.map((n) => (
                      <span key={n} className={`chip ${f.barbarian ? 'chip-red' : ''}`}>
                        {n}
                      </span>
                    ))}
                  </div>
                  <div className="flag-memo">{f.memo}</div>
                  {f.tx_hash && chain ? (
                    <a className="view-all" href={flagTxUrl(chain.explorer_tx_url, f.tx_hash)} target="_blank" rel="noreferrer">
                      View transaction <IconExternal size={13} />
                    </a>
                  ) : f.expected_tx_hash ? (
                    <small className="muted mono">signed tx {f.expected_tx_hash.slice(0, 18)}… awaiting broadcast</small>
                  ) : f.error ? (
                    <small className="error">{f.error}</small>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      <div className="grid-2">
        <Panel title="Epoch history">
          <EpochHistory />
        </Panel>
        <Panel title="Activity">
          {game.activity.length === 0 ? (
            <Empty>No activity yet.</Empty>
          ) : (
            <ul className="act-list">
              {game.activity.map((a, i) => (
                <li key={i}>
                  {activityIcon(a.kind)}
                  <span className="act-text">{a.text}</span>
                  <span className="act-meta">{timeAgo(Number(a.ts_ms), game.now())}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
