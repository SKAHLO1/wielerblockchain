export type ChainKind = 'Evm' | 'Bitcoin' | 'Solana';

export interface Chain {
  id: string;
  name: string;
  kind: ChainKind;
  path: string;
  derived_pubkey: string;
  derived_address: string;
  evm_chain_id: number | null;
  btc_hrp: string | null;
  explorer_tx_url: string;
  payload_limit: number;
  max_fee: string;
  gas_reserve: string;
  conquest_count: number;
  min_target: string;
  territory_account: string | null;
}

export interface Holder {
  account_id: string;
  stake: string;
}

export interface Territory {
  chain: string;
  holders: Holder[];
  total_stake: string;
  held_since_epoch: number;
  barbarian: boolean;
  clan: string | null;
  bounty_escrow: string;
}

export type OutcomeKind = 'Empty' | 'Conquered' | 'Reconquered' | 'Defended';

export interface Outcome {
  kind: OutcomeKind;
  chain: string | null;
  burn_bps: number;
  winners: string[];
  winning_stake: string;
  defending_stake: string;
  burned: string;
  fee_total: string;
  barbarian_won: boolean;
  barbarian_escrow_bps: number;
  flag_id: number | null;
  keeper: string;
}

export interface ChainStake {
  chain: string;
  amount: string;
  stakers: number;
}

export interface Epoch {
  id: number;
  start_ns: string;
  end_ns: string;
  chain_stakes: ChainStake[];
  total: string;
  closed: boolean;
  outcome: Outcome | null;
}

export type FlagStatus = 'AwaitingTx' | 'Signing' | 'Signed' | 'Broadcast' | 'Failed';

export interface Flag {
  id: number;
  chain: string;
  epoch: number;
  names: string[];
  memo: string;
  barbarian: boolean;
  status: FlagStatus;
  tx_params: string | null;
  unsigned_tx: string | null;
  payload: string | null;
  signed_tx: string | null;
  expected_tx_hash: string | null;
  tx_hash: string | null;
  explorer_url: string | null;
  created_ms: string;
  error: string | null;
}

export interface MapChain {
  chain: Chain;
  territory: Territory | null;
  epoch_stake: string;
  epoch_stakers: number;
  target: string;
}

export interface MapView {
  epoch: Epoch;
  now_ms: string;
  chains: MapChain[];
  total_burned: string;
  flags: number;
  clans: number;
  barbarian: string | null;
  barbarian_attestation_url: string | null;
}

export interface Raider {
  total_staked: string;
  active_stake: string;
  burned: string;
  conquests: number;
  clan: string | null;
}

export interface Clan {
  name: string;
  members: number;
  total_staked: string;
  conquests: number;
}

export interface Activity {
  kind: string;
  text: string;
  chain: string | null;
  flag_id: number | null;
  ts_ms: string;
}

export interface SupplyPoint {
  epoch: number;
  ts_ms: string;
  burned_total: string;
  chain: string | null;
}

export interface AccountStake {
  epoch: number;
  chain: string;
  amount: string;
  settled: boolean;
  claimable: string | null;
}
