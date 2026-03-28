export type TokenType = 'ALEO' | 'USDCX' | 'USAD'

export interface Market {
  id: string
  creator: string
  resolver: string
  question_hash: string
  category: number
  num_outcomes: number
  deadline: number
  resolution_deadline: number
  status: number
  created_at: number
  token_type: number
  total_liquidity: number
  total_volume: number
  winning_outcome?: number
}

export interface AMMPool {
  market_id: string
  reserve_1: string
  reserve_2: string
  reserve_3: string
  reserve_4: string
  reserve_5: string
  reserve_6: string
  reserve_7: string
  reserve_8: string
  total_liquidity: string
  total_lp_shares: string
  total_volume: string
}

export interface VoteTally {
  market_id: string
  outcome_1_bonds: string
  outcome_2_bonds: string
  outcome_3_bonds: string
  outcome_4_bonds: string
  outcome_5_bonds: string
  outcome_6_bonds: string
  outcome_7_bonds: string
  outcome_8_bonds: string
  total_voters: number
  total_bonded: string
  voting_deadline: number
  dispute_deadline: number
  finalized: boolean
  winning_outcome: number
}

export interface MarketMetadata {
  market_id: string
  question_text: string
  description?: string
  outcome_labels: string[]
  image_url?: string
  ipfs_cid?: string
  source_url?: string
}

export interface PriceSnapshot {
  market_id: string
  prices: number[]
  reserves: string[]
  total_liquidity: string
  block_height: number
}
