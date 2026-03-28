import { Hono } from 'hono'
import { getMappingValue, parseLeoValue } from '../services/aleo-rpc.js'

const PROTOCOL_FEE_BPS = 50n
const CREATOR_FEE_BPS = 50n
const LP_FEE_BPS = 100n
const FEE_DENOMINATOR = 10000n

// FPMM buy: r_i_new = r_i * prod(r_k / (r_k + a)) for active k != i
function calcBuySharesOut(reserves: bigint[], numOutcomes: number, outcome: number, amountIn: bigint): bigint {
  const protocolFee = (amountIn * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR
  const creatorFee = (amountIn * CREATOR_FEE_BPS) / FEE_DENOMINATOR
  const a = amountIn - protocolFee - creatorFee

  const r_i = reserves[outcome - 1]
  let stepResult = r_i

  for (let k = 0; k < numOutcomes; k++) {
    if (k === outcome - 1) continue
    const r_k = reserves[k]
    stepResult = (stepResult * r_k) / (r_k + a)
  }

  const r_i_new = stepResult
  return r_i + a - r_i_new
}

// FPMM sell: r_i_new = r_i * prod(r_k / (r_k - p)) for active k != i
function calcSellSharesNeeded(reserves: bigint[], numOutcomes: number, outcome: number, tokensDesired: bigint): bigint {
  const lpFee = (tokensDesired * LP_FEE_BPS) / FEE_DENOMINATOR
  const p = tokensDesired - lpFee

  const r_i = reserves[outcome - 1]
  let stepResult = r_i

  for (let k = 0; k < numOutcomes; k++) {
    if (k === outcome - 1) continue
    const r_k = reserves[k]
    if (r_k <= p) throw new Error('Pool too thin for sell')
    stepResult = (stepResult * r_k) / (r_k - p)
  }

  return stepResult - r_i + p
}

function getAllPrices(reserves: bigint[], numOutcomes: number): number[] {
  const products = reserves.slice(0, numOutcomes).map((_, i) =>
    reserves.slice(0, numOutcomes).reduce((acc, r, j) => (j === i ? acc : acc * r), 1n)
  )
  const sumProducts = products.reduce((a, b) => a + b, 0n)
  return products.map(p => sumProducts > 0n ? Number(p * 1_000_000n / sumProducts) / 1_000_000 : 1 / numOutcomes)
}

const app = new Hono()

// POST /api/markets/:id/simulate
app.post('/:id/simulate', async (c) => {
  const marketId = c.req.param('id')
  const { outcome, amount, side = 'buy', programId = 'veilo_market_v1.aleo' } = await c.req.json()

  const poolRaw = await getMappingValue(programId, 'amm_pools', marketId)
  if (!poolRaw) return c.json({ error: 'Market pool not found' }, 404)

  const marketRaw = await getMappingValue(programId, 'markets', marketId)
  if (!marketRaw) return c.json({ error: 'Market not found' }, 404)

  const numOutcomes = Number(parseLeoValue(marketRaw.num_outcomes))
  const reserves = [
    BigInt(parseLeoValue(poolRaw.reserve_1)), BigInt(parseLeoValue(poolRaw.reserve_2)),
    BigInt(parseLeoValue(poolRaw.reserve_3)), BigInt(parseLeoValue(poolRaw.reserve_4)),
    BigInt(parseLeoValue(poolRaw.reserve_5)), BigInt(parseLeoValue(poolRaw.reserve_6)),
    BigInt(parseLeoValue(poolRaw.reserve_7)), BigInt(parseLeoValue(poolRaw.reserve_8)),
  ]

  const amountBig = BigInt(Math.floor(Number(amount) * 1_000_000))
  const pricesBefore = getAllPrices(reserves, numOutcomes)

  try {
    if (side === 'buy') {
      const sharesOut = calcBuySharesOut(reserves, numOutcomes, outcome, amountBig)
      const protocolFee = (amountBig * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR
      const creatorFee = (amountBig * CREATOR_FEE_BPS) / FEE_DENOMINATOR
      const totalFee = protocolFee + creatorFee

      // Simulate post-trade reserves for price impact
      const a = amountBig - totalFee
      const newReserves = [...reserves]
      for (let k = 0; k < numOutcomes; k++) {
        if (k === outcome - 1) newReserves[k] = reserves[k] + a - sharesOut
        else newReserves[k] = reserves[k] + a
      }
      const pricesAfter = getAllPrices(newReserves, numOutcomes)
      const priceImpact = Math.abs(pricesAfter[outcome - 1] - pricesBefore[outcome - 1])

      return c.json({
        side: 'buy',
        outcome,
        amount_in: amountBig.toString(),
        shares_out: sharesOut.toString(),
        avg_price: Number(amountBig) / Number(sharesOut),
        price_before: pricesBefore[outcome - 1],
        price_after: pricesAfter[outcome - 1],
        price_impact: priceImpact,
        fees: {
          protocol: protocolFee.toString(),
          creator: creatorFee.toString(),
          total: totalFee.toString(),
        },
        all_prices_before: pricesBefore,
        all_prices_after: pricesAfter,
      })
    } else {
      const sharesNeeded = calcSellSharesNeeded(reserves, numOutcomes, outcome, amountBig)
      const protocolFee = (amountBig * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR
      const creatorFee = (amountBig * CREATOR_FEE_BPS) / FEE_DENOMINATOR
      const lpFee = (amountBig * LP_FEE_BPS) / FEE_DENOMINATOR
      const netTokens = amountBig - protocolFee - creatorFee - lpFee

      return c.json({
        side: 'sell',
        outcome,
        tokens_desired: amountBig.toString(),
        shares_needed: sharesNeeded.toString(),
        net_tokens: netTokens.toString(),
        fees: {
          protocol: protocolFee.toString(),
          creator: creatorFee.toString(),
          lp: lpFee.toString(),
          total: (protocolFee + creatorFee + lpFee).toString(),
        },
        all_prices: pricesBefore,
      })
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// GET /api/markets/:id/pool  — returns live pool state from chain (not DB cache)
app.get('/:id/pool', async (c) => {
  const marketId = c.req.param('id')
  const programId = c.req.query('programId') ?? 'veilo_market_v1.aleo'

  const [poolRaw, feesRaw, marketRaw] = await Promise.all([
    getMappingValue(programId, 'amm_pools', marketId),
    getMappingValue(programId, 'market_fees', marketId),
    getMappingValue(programId, 'markets', marketId),
  ])

  if (!poolRaw) return c.json({ error: 'Pool not found' }, 404)

  const totalLpShares = BigInt(parseLeoValue(poolRaw.total_lp_shares ?? '0'))
  const totalLiquidity = BigInt(parseLeoValue(poolRaw.total_liquidity ?? '0'))
  const creatorFees = feesRaw ? BigInt(parseLeoValue(feesRaw.creator_fees ?? '0')) : 0n
  const numOutcomes = marketRaw ? Number(parseLeoValue(marketRaw.num_outcomes ?? '2')) : 2

  const allReserves = [
    parseLeoValue(poolRaw.reserve_1), parseLeoValue(poolRaw.reserve_2),
    parseLeoValue(poolRaw.reserve_3), parseLeoValue(poolRaw.reserve_4),
    parseLeoValue(poolRaw.reserve_5), parseLeoValue(poolRaw.reserve_6),
    parseLeoValue(poolRaw.reserve_7), parseLeoValue(poolRaw.reserve_8),
  ]
  const reserves = allReserves.slice(0, numOutcomes)
  const reservesBig = reserves.map(r => BigInt(r))
  const prices = getAllPrices(reservesBig, numOutcomes)

  return c.json({
    total_lp_shares: totalLpShares.toString(),
    total_liquidity: totalLiquidity.toString(),
    creator_fees: creatorFees.toString(),
    reserves,
    prices,
    num_outcomes: numOutcomes,
  })
})

// POST /api/markets/:id/simulate-lp — estimate LP shares for an add_liquidity amount
app.post('/:id/simulate-lp', async (c) => {
  const marketId = c.req.param('id')
  const { amount, programId = 'veilo_market_v1.aleo' } = await c.req.json()

  const poolRaw = await getMappingValue(programId, 'amm_pools', marketId)
  if (!poolRaw) return c.json({ error: 'Pool not found' }, 404)

  const totalLpShares = BigInt(parseLeoValue(poolRaw.total_lp_shares ?? '0'))
  const reserves = [
    BigInt(parseLeoValue(poolRaw.reserve_1)), BigInt(parseLeoValue(poolRaw.reserve_2)),
    BigInt(parseLeoValue(poolRaw.reserve_3)), BigInt(parseLeoValue(poolRaw.reserve_4)),
    BigInt(parseLeoValue(poolRaw.reserve_5)), BigInt(parseLeoValue(poolRaw.reserve_6)),
    BigInt(parseLeoValue(poolRaw.reserve_7)), BigInt(parseLeoValue(poolRaw.reserve_8)),
  ]
  const totalReserves = reserves.reduce((a, b) => a + b, 0n)
  const amountBig = BigInt(Math.floor(Number(amount) * 1_000_000))

  if (totalReserves === 0n) return c.json({ error: 'Empty pool' }, 400)

  const lpShares = (amountBig * totalLpShares) / totalReserves
  const poolSharePct = totalLpShares > 0n
    ? Number((amountBig * 10_000n) / totalReserves) / 100
    : 100

  return c.json({
    amount: amountBig.toString(),
    lp_shares: lpShares.toString(),
    pool_share_pct: poolSharePct,
  })
})

export default app
