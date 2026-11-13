'use client';

import { useState } from 'react';
import { ChainIcon, ART } from '@/components/icons';
import { Empty, Panel, useUi, PageHero } from '@/components/ui';
import { progressPct } from '@/lib/game';
import { CONFIG, fmtCompact, fmtFull, TGAS } from '@/lib/near';
import { useGame, useWallet } from '@/lib/providers';

const STORAGE_DEPOSIT = '1250000000000000000000'; // 0.00125 NEAR

export default function StakingPage() {
  const game = useGame();
  const { accountId, signIn, call } = useWallet();
  const { openStake, run } = useUi();
  const [clan, setClan] = useState('');
  const chains = game.map?.chains ?? [];
  const stakes = game.me?.stakes ?? [];
  const currentEpoch = game.map?.epoch.id;

  return (
    <div className="page">
      <PageHero title="Staking" sub="Pick a chain, stake WIELER behind it and raid it before the epoch ends." art={ART.raiders} icon={ART.shield} />
      <div className="grid-3">
        <Panel className="stat-tile">
          <small>Your WIELER balance</small>
          <strong>{accountId ? fmtFull(game.me?.balance) : '—'}</strong>
        </Panel>
        <Panel className="stat-tile">
          <small>Staked (active)</small>
          <strong>{accountId ? fmtFull(game.me?.raider?.active_stake ?? '0') : '—'}</strong>
        </Panel>
        <Panel className="stat-tile">
          <small>Total staked this epoch</small>
          <strong>{fmtFull(game.map?.epoch.total)}</strong>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Testnet faucet">
          <p className="muted small">
            Claim 25,000 WIELER from the community allocation every 12 hours. The first claim also registers your account
            on the token (0.00125 NEAR storage deposit). The faucet transfers existing supply; nothing is minted.
          </p>
          <button
            className="btn btn-primary"
            onClick={() =>
              accountId
                ? run('Claim WIELER from faucet', () =>
                    call({
                      receiverId: CONFIG.tokenContract,
                      method: 'faucet',
                      deposit: game.me?.registered ? '0' : STORAGE_DEPOSIT,
                      gas: 30n * TGAS,
                    }),
                  )
                : signIn()
            }
          >
            {accountId ? 'Claim 25,000 WIELER' : 'Connect Wallet'}
          </button>
        </Panel>
        <Panel title="Clan">
          <p className="muted small">
            Clans are named groups of raiders. Your stake counts toward your clan&apos;s total, and a territory takes the name
            of the clan that staked most to win it. Current clan: <b>{game.me?.raider?.clan ?? 'none'}</b>
          </p>
          <div className="input-row">
            <input
              className="input"
              placeholder="e.g. CryptoVikings"
              value={clan}
              maxLength={24}
              onChange={(e) => setClan(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))}
            />
            <button
              className="btn btn-dark"
              disabled={!clan}
              onClick={() =>
                accountId
                  ? run(`Join clan ${clan}`, () =>
                      call({ receiverId: CONFIG.raidContract, method: 'join_clan', args: { name: clan }, gas: 30n * TGAS }),
                    )
                  : signIn()
              }
            >
              Join
            </button>
          </div>
        </Panel>
      </div>

      <Panel title={`Raid targets · epoch ${currentEpoch ?? '—'}`}>
        {chains.length === 0 ? (
          <Empty>No target chains registered yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Chain</th>
                  <th className="num">Staked</th>
                  <th className="num">Raiders</th>
                  <th className="num">Target</th>
                  <th style={{ width: '28%' }}>Progress</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {chains.map((c) => (
                  <tr key={c.chain.id}>
                    <td>
                      <span className="chain-row">
                        <ChainIcon id={c.chain.id} size={24} /> {c.chain.name}
                      </span>
                    </td>
                    <td className="num">{fmtCompact(c.epoch_stake)}</td>
                    <td className="num">{c.epoch_stakers}</td>
                    <td className="num">{fmtCompact(c.target)}</td>
                    <td>
                      <div className="progress-row" style={{ margin: 0 }}>
                        <div className="progress">
                          <span style={{ width: `${progressPct(c)}%` }} />
                        </div>
                        <b>{Math.round(progressPct(c))}%</b>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-dark" onClick={() => openStake(c.chain.id)}>
                        Stake Now
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Your stakes">
        {!accountId ? (
          <Empty>Connect a wallet to see your stakes.</Empty>
        ) : stakes.length === 0 ? (
          <Empty>You have not staked yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Epoch</th>
                  <th>Chain</th>
                  <th className="num">Staked</th>
                  <th className="num">Returns</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...stakes].reverse().map((s) => {
                  const ep = s.epoch;
                  const open = ep === currentEpoch;
                  return (
                    <tr key={`${s.epoch}-${s.chain}`}>
                      <td>#{s.epoch}</td>
                      <td>
                        <span className="chain-row">
                          <ChainIcon id={s.chain} size={20} /> {s.chain}
                        </span>
                      </td>
                      <td className="num">{fmtFull(s.amount)}</td>
                      <td className="num">{s.claimable ? fmtFull(s.claimable) : '—'}</td>
                      <td>
                        {s.settled ? (
                          <span className="chip chip-grey">Withdrawn</span>
                        ) : open ? (
                          <span className="chip chip-amber">Raiding</span>
                        ) : s.claimable ? (
                          <span className="chip chip-green">Ready</span>
                        ) : (
                          <span className="chip chip-grey">Awaiting close</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {!s.settled && s.claimable && (
                          <button
                            className="btn btn-dark"
                            onClick={() =>
                              run(`Unstake epoch ${s.epoch} ${s.chain}`, () =>
                                call({
                                  receiverId: CONFIG.raidContract,
                                  method: 'unstake',
                                  args: { epoch: s.epoch, chain: s.chain },
                                  gas: 100n * TGAS,
                                }),
                              )
                            }
                          >
                            Unstake
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          Returns = stake minus the 2% raid fee, minus 10% (first conquest) or 5% (re-conquest) if you were on the winning side.
        </p>
      </Panel>
    </div>
  );
}
