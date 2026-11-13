'use client';

import { useEffect, useMemo, useState } from 'react';
import Globe from '@/components/Globe';
import { ART, ChainIcon, IconExternal, IconWarn } from '@/components/icons';
import { Empty, PageHero, Panel } from '@/components/ui';
import { addressUrl, chainStatus, markersFor, short } from '@/lib/game';
import { foreignBalance } from '@/lib/foreign';
import { CONFIG, fmtCompact } from '@/lib/near';
import { useGame } from '@/lib/providers';

export default function MapPage() {
  const game = useGame();
  const markers = useMemo(() => markersFor(game.map), [game.map]);
  const chains = game.map?.chains ?? [];
  const [gas, setGas] = useState<Record<string, { text: string; low: boolean }>>({});
  const barbHolds = chains.some((c) => c.territory?.barbarian);
  const chainKey = chains.map((c) => c.chain.derived_address).join(',');

  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = await Promise.all(chains.map(async (c) => [c.chain.id, await foreignBalance(c.chain)] as const));
      if (alive) setGas(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey]);

  return (
    <div className="page">
      <PageHero
        title="The WIELER Empire"
        sub="Every territory, every derived wallet and the Barbarian that raids them."
        art={ART.battlefield}
        icon={ART.helmet}
      />
      <div className="grid-2">
        <Panel title="World Map">
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Globe markers={markers} compact />
          </div>
          <p className="muted small">
            Every foreign wallet below is derived from one NEAR contract ({CONFIG.raidContract || 'raid contract'}) through NEAR
            Chain Signatures. No bridge, no custodian: the MPC network signs only flag transactions the contract builds.
          </p>
        </Panel>
        <Panel title="The Barbarian">
          <img
            src={barbHolds ? ART.barbarianVictorious : game.map?.barbarian ? ART.barbarianAttacking : ART.barbarianDefending}
            alt={barbHolds ? 'The Barbarian, victorious' : 'The Barbarian'}
            className="barb-pose"
          />
          <dl className="kv">
            <dt>Account</dt>
            <dd className="mono">{game.map?.barbarian ?? 'not registered'}</dd>
            <dt>War chest</dt>
            <dd>{fmtCompact(game.warChest)} WIELER</dd>
            <dt>Territories</dt>
            <dd>{chains.filter((c) => c.territory?.barbarian).map((c) => c.chain.name).join(', ') || 'none'}</dd>
            <dt>Attestation</dt>
            <dd>
              {game.map?.barbarian_attestation_url ? (
                <a href={game.map.barbarian_attestation_url} target="_blank" rel="noreferrer" className="view-all">
                  View attestation <IconExternal size={13} />
                </a>
              ) : (
                <span className="muted">Agent runs locally (PRD fallback); no TEE attestation published yet.</span>
              )}
            </dd>
          </dl>
          <h3 style={{ fontSize: 15, margin: '22px 0 10px' }}>Legend</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="chip">Held by raiders</span>
            <span className="chip chip-amber">Under attack this epoch</span>
            <span className="chip chip-red">Barbarian territory</span>
            <span className="chip chip-grey">Unclaimed</span>
          </div>
        </Panel>
      </div>

      <Panel title="Chains and WIELER wallets">
        {chains.length === 0 ? (
          <Empty>No chains registered yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Chain</th>
                  <th>Status</th>
                  <th>WIELER wallet (derived)</th>
                  <th>Path</th>
                  <th>Holders</th>
                  <th className="num">Epoch stake</th>
                  <th className="num">Conquests</th>
                  <th>Foreign gas</th>
                </tr>
              </thead>
              <tbody>
                {chains.map((c) => {
                  const st = game.map ? chainStatus(c, game.map) : { text: '', tone: 'idle' };
                  const chipClass =
                    st.tone === 'barbarian' ? 'chip-red' : st.tone === 'attack' ? 'chip-amber' : st.tone === 'held' ? '' : 'chip-grey';
                  const g = gas[c.chain.id];
                  return (
                    <tr key={c.chain.id}>
                      <td>
                        <span className="chain-row">
                          <ChainIcon id={c.chain.id} size={24} />
                          {c.chain.name}
                        </span>
                      </td>
                      <td>
                        <span className={`chip ${chipClass}`}>{st.text}</span>
                      </td>
                      <td className="mono">
                        <a href={addressUrl(c.chain)} target="_blank" rel="noreferrer">
                          {c.chain.derived_address}
                        </a>
                      </td>
                      <td className="mono">{c.chain.path}</td>
                      <td>
                        {c.territory
                          ? c.territory.holders
                              .slice(0, 3)
                              .map((h) => short(h.account_id))
                              .join(', ') + (c.territory.holders.length > 3 ? ` +${c.territory.holders.length - 3}` : '')
                          : '—'}
                      </td>
                      <td className="num">{fmtCompact(c.epoch_stake)}</td>
                      <td className="num">{c.chain.conquest_count}</td>
                      <td>
                        {g ? (
                          <span className={g.low ? 'chip chip-amber' : ''}>
                            {g.low && <IconWarn size={13} />} {g.text}
                            {g.low ? ' · top up from a faucet' : ''}
                          </span>
                        ) : (
                          '…'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
