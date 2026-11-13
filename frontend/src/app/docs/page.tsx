'use client';

import { ART } from '@/components/icons';
import { Panel, PageHero } from '@/components/ui';
import { CONFIG } from '@/lib/near';
import { useGame } from '@/lib/providers';

export default function DocsPage() {
  const game = useGame();
  return (
    <div className="page docs">
      <PageHero title="How WIELER works" sub="The rules of the raid, the Barbarian and the contracts behind them." art={ART.clanLeader} icon={ART.scroll} />
      <Panel>
        <p>
          WIELER is a NEP-141 memecoin on NEAR whose raid contract controls real wallets on Bitcoin, Ethereum and Solana
          through NEAR Chain Signatures. There is no bridge and no wrapped asset. Holders stake WIELER to raid those chains,
          and every winning raid signs a transaction on the target chain that engraves the raiders&apos; .near names there and
          burns part of the supply.
        </p>
        <h3>The raid loop (one epoch)</h3>
        <ol>
          <li>Raiders stake WIELER behind a chain with <code>ft_transfer_call</code>; the message names the chain.</li>
          <li>When the epoch ends, anyone calls <code>close_epoch</code> and earns the keeper tip.</li>
          <li>The most-staked chain is raided. An unheld chain is conquered; a held chain changes hands only if the challengers out-stake its holders.</li>
          <li>A conquest burns stake and creates a flag. The broadcaster supplies the foreign nonce, UTXO or blockhash, the contract builds the transaction itself and the NEAR MPC network signs it.</li>
          <li>The signed transaction is broadcast, and <code>confirm_broadcast</code> records its hash. The contract only accepts the hash of the transaction it built.</li>
        </ol>
        <h3>Economics</h3>
        <ul>
          <li>Fixed supply: 1,000,000,000 WIELER, minted once. 70% community (faucet), 20% raid rewards pool, 10% team. No mint method exists.</li>
          <li>First conquest: the winners burn 10% of their stake. Re-conquest: the challengers burn 5%.</li>
          <li>Defence holds: no flag and no burn.</li>
          <li>Raid fee: 2% of all stake each epoch. 1% goes to the target chain&apos;s holders, 0.5% to the flag gas reserve and 0.5% to the keeper.</li>
          <li>Losing stakes come back in full, minus the raid fee.</li>
        </ul>
        <h3 id="barbarian">The Barbarian</h3>
        <p>
          The Barbarian is an AI raider with its own NEAR account and its own WIELER. Every epoch it picks one target with a
          published strategy (the weakest defended chain, or the one held longest) and stakes behind it. It follows the
          same rules as players, plus caps: at most 40% of the other raiders&apos; stake that epoch (or a 250K floor), and one
          chain per epoch. When it conquers a chain, 10% of its stake is held in escrow and paid to the players who take the chain back.
        </p>
        <p className="muted small">
          The PRD targets a Shade Agent in a TEE. This build runs the agent locally with the same code (the PRD&apos;s fallback);
          see <code>scripts/barbarian.mjs</code>.
        </p>
        <h3>Contracts (NEAR testnet)</h3>
        <ul>
          <li>Token: <code>{CONFIG.tokenContract || 'not deployed'}</code></li>
          <li>Raid game: <code>{CONFIG.raidContract || 'not deployed'}</code></li>
          <li>Barbarian: <code>{game.map?.barbarian || CONFIG.barbarian || 'not registered'}</code></li>
          <li>MPC signer: <code>v1.signer-prod.testnet</code></li>
        </ul>
      </Panel>
    </div>
  );
}
