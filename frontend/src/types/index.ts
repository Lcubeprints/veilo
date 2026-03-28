export type TokenType = 'ALEO' | 'USDCX' | 'USAD'

export interface Market {
  id: string
  program_id?: string
  creator: string
  resolver: string
  question_hash: string
  category: number
  num_outcomes: number     // 2–8
  deadline: number         // block height
  resolution_deadline: number
  status: number           // 1=Active 2=Closed 3=Resolved 4=Cancelled 5=PendingResolution 6=PendingFinalization
  token_type: number       // 1=ALEO 2=USDCX 3=USAD
  total_liquidity: number
  total_volume: number
  winning_outcome?: number
  // Joined from market_metadata
  market_metadata?: MarketMetadata
}

export interface MarketMetadata {
  market_id: string
  question_text: string
  description?: string
  outcome_labels: string[]   // length = num_outcomes
  image_url?: string
  ipfs_cid?: string
  source_url?: string
}

export interface AMMPool {
  reserve_1: bigint
  reserve_2: bigint
  reserve_3: bigint
  reserve_4: bigint
  reserve_5: bigint
  reserve_6: bigint
  reserve_7: bigint
  reserve_8: bigint
  total_liquidity: bigint
  total_lp_shares: bigint
  total_volume: bigint
}

export interface PriceSnapshot {
  market_id: string
  prices: number[]
  reserves: string[]
  total_liquidity: string
  block_height: number
  recorded_at: string
}

export interface SimulateResult {
  side: 'buy' | 'sell'
  outcome: number
  shares_out?: string
  shares_needed?: string
  avg_price?: number
  price_before?: number
  price_after?: number
  price_impact?: number
  net_tokens?: string
  fees: { protocol: string; creator: string; lp?: string; total: string }
  all_prices_before?: number[]
  all_prices_after?: number[]
  all_prices?: number[]
}

export interface OutcomeShare {
  owner: string
  market_id: string
  outcome: number
  quantity: bigint
  share_nonce: string
  token_type: number
}

export interface LPToken {
  owner: string
  market_id: string
  lp_shares: bigint
  lp_nonce: string
  token_type: number
}

export interface VoterBondReceipt {
  owner: string
  market_id: string
  voted_outcome: number
  bond_amount: bigint
  bond_nonce: string
}

export interface Resolution {
  market_id: string
  proposed_outcome?: number
  outcome_bonds: Record<string, string>
  outcome_weights?: Record<string, string> | null  // v2 only: share-vote weights per outcome
  total_voters: number
  voting_deadline?: number
  dispute_deadline?: number
  disputed: boolean
  finalized: boolean
}

// v2: Oracle Accuracy Score profile (from oracle_profiles mapping)
export interface OracleProfile {
  votes_cast: number
  votes_correct: number
  streak: number
  best_streak: number
  total_bonus_earned: string   // u128 as string
  pending_bonus: string        // from oracle_pending_bonus mapping, u128 as string
}

// Status constants
export const MARKET_STATUS = {
  ACTIVE: 1,
  CLOSED: 2,
  RESOLVED: 3,
  CANCELLED: 4,
  PENDING_RESOLUTION: 5,
  PENDING_FINALIZATION: 6,
  DISPUTED: 7,
} as const

export const CATEGORY_LABELS: Record<number, string> = {
  1: 'Politics',
  2: 'Sports',
  3: 'Crypto',
  4: 'Entertainment',
  5: 'Other',
}

export const TOKEN_LABELS: Record<number, string> = {
  1: 'ALEO',
  2: 'USDCX',
  3: 'USAD',
}
