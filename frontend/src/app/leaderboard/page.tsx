'use client';

import { useState } from 'react';
import { useLeaderboard } from '@/components/home';
import { IconCrown, ART } from '@/components/icons';
import { Empty, Panel, PageHero } from '@/components/ui';
import { fmtCompact } from '@/lib/near';
import { useWallet } from '@/lib/providers';

type Tab = 'Raiders' | 'Clans' | 'Territories';

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>('Raiders');
  const rows = useLeaderboard(tab);
  const { accountId } = useWallet();
  return (
    <div className="page">
      <PageHero title="Leaderboard" sub="The raiders, clans and territories that rule the WIELER Empire." art={ART.throne} icon={ART.trophy} />
      <Panel>
        <div className="tabs" role="tablist" style={{ maxWidth: 480 }}>
          {(['Raiders', 'Clans', 'Territories'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <Empty>No {tab.toLowerCase()} yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>{tab === 'Territories' ? 'Territory' : tab === 'Clans' ? 'Clan' : 'Raider'}</th>
                  <th>Details</th>
                  <th className="num">{tab === 'Territories' ? 'Winning stake' : 'Total staked'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} style={r.name === accountId ? { background: 'rgba(59,130,246,0.12)' } : undefined}>
                    <td>{i === 0 ? <IconCrown size={18} className="lb-icon gold" /> : i + 1}</td>
                    <td>
                      {r.name} {r.barbarian && <span className="chip chip-red">Barbarian</span>}
                    </td>
                    <td className="muted">{r.sub}</td>
                    <td className="num">{fmtCompact(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
