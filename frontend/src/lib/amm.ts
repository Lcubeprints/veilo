// ============================================================================
// VEILO — FPMM AMM Math (mirrors on-chain Leo contract exactly)
// Supports 2–8 outcomes
// ============================================================================

export const PROTOCOL_FEE_BPS = 50n
export const CREATOR_FEE_BPS = 50n
export const LP_FEE_BPS = 100n
export const FEE_DENOMINATOR = 10000n

export interface AMMReserves {
  reserve_1: bigint
  reserve_2: bigint
  reserve_3: bigint
  reserve_4: bigint
  reserve_5: bigint
  reserve_6: bigint
  reserve_7: bigint
  reserve_8: bigint
  num_outcomes: number
  total_lp_shares: bigint
}

export function getActiveReserves(pool: AMMReserves): bigint[] {
  return [
    pool.reserve_1, pool.reserve_2, pool.reserve_3, pool.reserve_4,
    pool.reserve_5, pool.reserve_6, pool.reserve_7, pool.reserve_8,
  ].slice(0, pool.num_outcomes)
}

export function getTotalReserves(pool: AMMReserves): bigint {
  return getActiveReserves(pool).reduce((a, b) => a + b, 0n)
}

/**
 * FPMM price of each outcome.
 * price_i = prod(r_j for j!=i) / sum_k(prod(r_j for j!=k))
 */
export function getAllPrices(pool: AMMReserves): number[] {
  const reserves = getActiveReserves(pool)
  const n = pool.num_outcomes

  if (n === 2) {
    const total = reserves[0] + reserves[1]
    if (total === 0n) return [0.5, 0.5]
    return [Number(reserves[1]) / Number(total), Number(reserves[0]) / Number(total)]
  }

  // General: use Number arithmetic for UI (acceptable precision loss)
  const rNums = reserves.map(r => Number(r))
  const products = rNums.map((_, i) =>
    rNums.reduce((acc, r, j) => (j === i ? acc : acc * r), 1)
  )
  const sumProducts = products.reduce((a, b) => a + b, 0)
  if (sumProducts === 0) return Array(n).fill(1 / n)
  return products.map(p => p / sumProducts)
}

export function getOutcomePrice(pool: AMMReserves, outcome: number): number {
  return getAllPrices(pool)[outcome - 1] ?? 0
}

/**
 * Calculate shares out for a buy order.
 * Mirrors buy_shares_finalize step-division in Leo.
 */
export function calcBuySharesOut(pool: AMMReserves, outcome: number, amountIn: bigint): bigint {
  const protocolFee = (amountIn * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR
  const creatorFee = (amountIn * CREATOR_FEE_BPS) / FEE_DENOMINATOR
  const a = amountIn - protocolFee - creatorFee

  const reserves = getActiveReserves(pool)
  const r_i = reserves[outcome - 1]

  // Step-division: multiply r_i by r_k / (r_k + a) for each k != outcome
  let stepResult = r_i
  for (let k = 0; k < pool.num_outcomes; k++) {
    if (k === outcome - 1) continue
    const r_k = reserves[k]
    stepResult = (stepResult * r_k) / (r_k + a)
  }

  const r_i_new = stepResult
  return r_i + a - r_i_new
}

/**
 * Calculate shares needed to sell for a given token output.
 * Mirrors sell_shares_finalize step-division in Leo.
 */
export function calcSellSharesNeeded(pool: AMMReserves, outcome: number, tokensDesired: bigint): bigint {
  const lpFee = (tokensDesired * LP_FEE_BPS) / FEE_DENOMINATOR
  const p = tokensDesired - lpFee

  const reserves = getActiveReserves(pool)
  const r_i = reserves[outcome - 1]

  let stepResult = r_i
  for (let k = 0; k < pool.num_outcomes; k++) {
    if (k === outcome - 1) continue
    const r_k = reserves[k]
    if (r_k <= p) throw new Error('Pool too thin for this sell size')
    stepResult = (stepResult * r_k) / (r_k - p)
  }

  return stepResult - r_i + p
}

export function calcFees(amountIn: bigint): {
  protocol: bigint; creator: bigint; lp: bigint; total: bigint; net: bigint
} {
  const protocol = (amountIn * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR
  const creator = (amountIn * CREATOR_FEE_BPS) / FEE_DENOMINATOR
  const lp = (amountIn * LP_FEE_BPS) / FEE_DENOMINATOR
  const total = protocol + creator + lp
  return { protocol, creator, lp, total, net: amountIn - total }
}

export function calcPriceImpact(pool: AMMReserves, outcome: number, sharesOut: bigint, amountIn: bigint): number {
  const protocolFee = (amountIn * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR
  const creatorFee = (amountIn * CREATOR_FEE_BPS) / FEE_DENOMINATOR
  const a = amountIn - protocolFee - creatorFee

  const reserves = getActiveReserves(pool)
  const newReserves = { ...pool }
  const newR = reserves.map((r, i) => {
    if (i === outcome - 1) return r + a - sharesOut
    return r + a
  })

  const poolAfter: AMMReserves = { ...pool }
  for (let i = 0; i < newR.length; i++) {
    const key = `reserve_${i + 1}` as keyof AMMReserves
    ;(poolAfter as any)[key] = newR[i]
  }

  const priceBefore = getOutcomePrice(pool, outcome)
  const priceAfter = getOutcomePrice(poolAfter, outcome)
  return Math.abs(priceAfter - priceBefore)
}

/**
 * Compute LP shares out for adding liquidity.
 * computed_shares = (amount * total_lp_shares) / total_reserves
 */
export function calcLPSharesOut(pool: AMMReserves, amount: bigint): bigint {
  const total = getTotalReserves(pool)
  if (total === 0n) return amount
  return (amount * pool.total_lp_shares) / total
}

// Parlay helpers
export function calcParlayMultiplier(odds: number[]): number {
  // odds = implied probability of each leg (0–1)
  return odds.reduce((acc, p) => acc / p, 1)
}

export function calcParlayPayout(cost: bigint, odds: number[]): bigint {
  const multiplier = calcParlayMultiplier(odds)
  return BigInt(Math.floor(Number(cost) * multiplier))
}
