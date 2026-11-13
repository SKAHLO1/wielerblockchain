'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { WalletSelector } from '@near-wallet-selector/core';
import type { WalletSelectorModal } from '@near-wallet-selector/modal-ui';
import { CONFIG, isDeployed, TGAS, view } from './near';
import type {
  AccountStake,
  Activity,
  Clan,
  Flag,
  MapView,
  Raider,
  SupplyPoint,
} from './types';

// ====================================================================== wallet

interface WalletCtx {
  accountId: string | null;
  ready: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  call: (opts: {
    receiverId: string;
    method: string;
    args?: object;
    deposit?: string;
    gas?: bigint;
  }) => Promise<unknown>;
}

const WalletContext = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let sub: { unsubscribe: () => void } | undefined;
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }, { setupMeteorWallet }, { setupHereWallet }] =
        await Promise.all([
          import('@near-wallet-selector/core'),
          import('@near-wallet-selector/modal-ui'),
          import('@near-wallet-selector/my-near-wallet'),
          import('@near-wallet-selector/meteor-wallet'),
          import('@near-wallet-selector/here-wallet'),
        ]);
      const sel = await setupWalletSelector({
        network: CONFIG.networkId,
        modules: [setupMyNearWallet(), setupMeteorWallet(), setupHereWallet()],
      });
      const m = setupModal(sel, { contractId: CONFIG.raidContract || 'wieler.testnet' });
      setSelector(sel);
      setModal(m);
      const state = sel.store.getState();
      setAccountId(state.accounts.find((a) => a.active)?.accountId ?? null);
      sub = sel.store.observable.subscribe((s) => {
        setAccountId(s.accounts.find((a) => a.active)?.accountId ?? null);
      });
      setReady(true);
    })().catch((e) => {
      console.error('wallet selector failed', e);
      setReady(true);
    });
    return () => sub?.unsubscribe();
  }, []);

  const signIn = useCallback(() => modal?.show(), [modal]);
  const signOut = useCallback(async () => {
    if (!selector) return;
    const w = await selector.wallet();
    await w.signOut();
  }, [selector]);

  const call: WalletCtx['call'] = useCallback(
    async ({ receiverId, method, args = {}, deposit = '0', gas = 100n * TGAS }) => {
      if (!selector) throw new Error('Wallet not ready');
      if (!accountId) {
        modal?.show();
        throw new Error('Connect a wallet first');
      }
      const w = await selector.wallet();
      return w.signAndSendTransaction({
        receiverId,
        actions: [
          {
            type: 'FunctionCall',
            params: { methodName: method, args, gas: gas.toString(), deposit },
          },
        ],
      });
    },
    [selector, accountId, modal],
  );

  const value = useMemo(() => ({ accountId, ready, signIn, signOut, call }), [accountId, ready, signIn, signOut, call]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet outside provider');
  return ctx;
}

// ====================================================================== game data

export interface GameData {
  loading: boolean;
  error: string | null;
  deployed: boolean;
  map: MapView | null;
  totalSupply: string;
  initialSupply: string;
  activity: Activity[];
  flags: Flag[];
  supply: SupplyPoint[];
  raiders: [string, Raider][];
  clans: Clan[];
  warChest: string;
  me: {
    balance: string;
    raider: Raider | null;
    stakes: AccountStake[];
    rewards: [string, string][];
    pending: string;
    registered: boolean;
  } | null;
  refresh: () => void;
  /** Local clock offset vs chain time (ms). */
  now: () => number;
}

const DataContext = createContext<GameData | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { accountId } = useWallet();
  const [state, setState] = useState<Omit<GameData, 'refresh' | 'now'>>({
    loading: true,
    error: null,
    deployed: isDeployed(),
    map: null,
    totalSupply: '0',
    initialSupply: (10n ** 27n).toString(),
    activity: [],
    flags: [],
    supply: [],
    raiders: [],
    clans: [],
    warChest: '0',
    me: null,
  });
  const offset = useRef(0);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!isDeployed()) {
      setState((s) => ({ ...s, loading: false, error: 'Contracts are not deployed yet. Run scripts/deploy.mjs.' }));
      return;
    }
    try {
      const raid = CONFIG.raidContract;
      const token = CONFIG.tokenContract;
      const [map, totalSupply, activity, flags, supply, raiders, clans] = await Promise.all([
        view<MapView>(raid, 'get_map'),
        view<string>(token, 'ft_total_supply'),
        view<Activity[]>(raid, 'get_activity', { limit: 30 }),
        view<Flag[]>(raid, 'get_flags', { limit: 100 }),
        view<SupplyPoint[]>(raid, 'get_supply_history'),
        view<[string, Raider][]>(raid, 'get_raiders', { limit: 500 }),
        view<Clan[]>(raid, 'get_clans'),
      ]);
      offset.current = Number(map.now_ms) - Date.now();
      const warChest = map.barbarian ? await view<string>(token, 'ft_balance_of', { account_id: map.barbarian }) : '0';
      let me: GameData['me'] = null;
      if (accountId) {
        const [balance, raider, stakes, rewards, pending, storage] = await Promise.all([
          view<string>(token, 'ft_balance_of', { account_id: accountId }),
          view<Raider | null>(raid, 'get_raider', { account_id: accountId }),
          view<AccountStake[]>(raid, 'get_account_stakes', { account_id: accountId }),
          view<[string, string][]>(raid, 'get_rewards', { account_id: accountId }),
          view<string>(raid, 'get_pending', { account_id: accountId }),
          view<unknown>(token, 'storage_balance_of', { account_id: accountId }),
        ]);
        me = { balance, raider, stakes, rewards, pending, registered: storage !== null };
      }
      setState({
        loading: false,
        error: null,
        deployed: true,
        map,
        totalSupply,
        initialSupply: (10n ** 27n).toString(),
        activity,
        flags,
        supply,
        raiders,
        clans,
        warChest,
        me,
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, [accountId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const now = useCallback(() => Date.now() + offset.current, []);
  const value = useMemo(() => ({ ...state, refresh, now }), [state, refresh, now]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useGame() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useGame outside provider');
  return ctx;
}

/** Re-renders every second, for countdowns. */
export function useClock(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
