'use client';

import { ChainIcon, ART } from '@/components/icons';
import { Empty, Panel, useUi, PageHero } from '@/components/ui';
import { countdown, CONFIG, fmtFull, TGAS, toBig } from '@/lib/near';
import { useClock, useGame, useWallet } from '@/lib/providers';

export default function RewardsPage() {
  useClock();
  const game = useGame();
  const { accountId, call } = useWallet();
  const { run } = useUi();
  const rewards = (game.me?.rewards ?? []).filter(([, v]) => toBig(v) > 0n);
  const pending = toBig(game.me?.pending);
  const epoch = game.map?.epoch;
  const remaining = epoch ? Number(BigInt(epoch.end_ns) / 1_000_000n) - game.now() : 0;
  const held = (game.map?.chains ?? []).filter((c) => c.territory?.holders.some((h) => h.account_id === accountId));

  return (
    <div className="page">
      <PageHero title="Rewards" sub="Territory shares, reclaim bounties and refunds waiting in your chest." art={ART.kingdom} icon={ART.chest} />
      <div className="grid-2">
        <Panel title="Territory rewards">
          <p className="muted small">
            Holders of a territory split 1% of every later epoch&apos;s stake in proportion to the stake they won it with, until
            the territory is taken. Players who retake a Barbarian territory also share its reclaim bounty.
          </p>
          {!accountId ? (
            <Empty>Connect a wallet to see your rewards.</Empty>
          ) : rewards.length === 0 ? (
            <Empty>No territory rewards to claim.</Empty>
          ) : (
            <table className="t">
              <tbody>
                {rewards.map(([chain, amount]) => (
                  <tr key={chain}>
                    <td>
                      <span className="chain-row">
                        <ChainIcon id={chain} size={22} /> {chain}
                      </span>
                    </td>
                    <td className="num">{fmtFull(amount)} WIELER</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-primary"
                        onClick={() =>
                          run(`Claim ${chain} rewards`, () =>
                            call({
                              receiverId: CONFIG.raidContract,
                              method: 'claim_territory_rewards',
                              args: { chain },
                              gas: 100n * TGAS,
                            }),
                          )
                        }
                      >
                        Claim
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {held.length > 0 && (
            <p className="small" style={{ marginTop: 14 }}>
              You currently hold: {held.map((c) => c.chain.name).join(', ')}.
            </p>
          )}
        </Panel>
        <Panel title="Keeper tips and pending payouts">
          <p className="muted small">
            Anyone can close an ended epoch and earn 0.5% of that epoch&apos;s stake. Tips, and any payout that failed to
            transfer, wait here until you claim them.
          </p>
          <dl className="kv" style={{ margin: '14px 0' }}>
            <dt>Claimable</dt>
            <dd>
              <b>{fmtFull(pending)} WIELER</b>
            </dd>
            <dt>Epoch {epoch?.id ?? '—'}</dt>
            <dd>{remaining > 0 ? `ends in ${countdown(remaining)}` : 'ended, ready to close'}</dd>
          </dl>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              disabled={!accountId || pending === 0n}
              onClick={() =>
                run('Claim pending payouts', () =>
                  call({ receiverId: CONFIG.raidContract, method: 'claim_pending', gas: 100n * TGAS }),
                )
              }
            >
              Claim {fmtFull(pending)} WIELER
            </button>
            <button
              className="btn btn-dark"
              disabled={!accountId || remaining > 0}
              onClick={() =>
                run('Close epoch', () => call({ receiverId: CONFIG.raidContract, method: 'close_epoch', gas: 300n * TGAS }))
              }
            >
              Close epoch (keeper)
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
