import { getLatestBlock, getBlockTransactions, getMappingValue, parseLeoValue, getTokenTypeFromProgramId } from './services/aleo-rpc.js'
import { getCursor, updateCursor, upsertMarket, upsertResolution, recordPriceSnapshot, db } from './services/supabase.js'

const PROGRAM_IDS = [
  // v1
  process.env.PROGRAM_ID_ALEO ?? 'veilo_market_v1.aleo',
  process.env.PROGRAM_ID_USDCX ?? 'veilo_market_usdcx_v1.aleo',
  process.env.PROGRAM_ID_USAD ?? 'veilo_market_usad_v1.aleo',
  // v2 — indexed alongside v1; same DB schema, token_type distinguishes markets
  process.env.PROGRAM_ID_V2_ALEO ?? 'veilo_market_v2.aleo',
  process.env.PROGRAM_ID_V2_USDCX ?? 'veilo_market_usdcx_v2.aleo',
  process.env.PROGRAM_ID_V2_USAD ?? 'veilo_market_usad_v2.aleo',
]

// How many blocks back to start if cursor is 0 (fresh DB)
const INITIAL_LOOKBACK = 200

/**
 * Try to link a pending market_metadata row (keyed by question_hash) to a
 * confirmed market_id. question_hash on-chain looks like "123456field" — we
 * strip the suffix before looking up in DB.
 */
async function linkMetadata(marketId: string, questionHashRaw: string) {
  // Strip "field" suffix: "123456field" → "123456"
  const questionHash = questionHashRaw.replace(/field$/, '')
  const { error } = await db
    .from('market_metadata')
    .update({ market_id: marketId })
    .eq('question_hash', questionHash)
    .is('market_id', null)
  if (error) console.warn('[Indexer] linkMetadata error:', error.message)
}

async function syncMarketFromChain(programId: string, marketId: string, block: number) {
  const [marketRaw, poolRaw] = await Promise.all([
    getMappingValue(programId, 'markets', marketId),
    getMappingValue(programId, 'amm_pools', marketId),
  ])

  if (!marketRaw || !poolRaw) return

  const m = marketRaw
  const p = poolRaw

  const numOutcomes = Number(parseLeoValue(m.num_outcomes))
  const reserves = [
    parseLeoValue(p.reserve_1), parseLeoValue(p.reserve_2),
    parseLeoValue(p.reserve_3), parseLeoValue(p.reserve_4),
    parseLeoValue(p.reserve_5), parseLeoValue(p.reserve_6),
    parseLeoValue(p.reserve_7), parseLeoValue(p.reserve_8),
  ]

  const activeReserves = reserves.slice(0, numOutcomes).map(r => BigInt(r))

  // FPMM prices: price_i = prod(r_j for j!=i) / sum(prod(r_j for j!=k) for each k)
  const products = activeReserves.map((_, i) =>
    activeReserves.reduce((acc, r, j) => (j === i ? acc : acc * r), 1n)
  )
  const sumProducts = products.reduce((a, b) => a + b, 0n)
  const prices = sumProducts > 0n
    ? products.map(p => Number(p * 1_000_000n / sumProducts) / 1_000_000)
    : activeReserves.map(() => 1 / numOutcomes)

  const questionHashRaw: string = m.question_hash ?? ''

  await upsertMarket({
    id: marketId,
    program_id: programId,
    creator: m.creator,
    resolver: m.resolver,
    question_hash: questionHashRaw,
    category: Number(parseLeoValue(m.category)),
    num_outcomes: numOutcomes,
    deadline: Number(parseLeoValue(m.deadline)),
    resolution_deadline: Number(parseLeoValue(m.resolution_deadline)),
    status: Number(parseLeoValue(m.status)),
    token_type: getTokenTypeFromProgramId(programId),
    total_liquidity: Number(parseLeoValue(p.total_liquidity)),
    total_volume: Number(parseLeoValue(p.total_volume)),
    winning_outcome: m.winning_outcome ? Number(parseLeoValue(m.winning_outcome)) : null,
    updated_at: new Date().toISOString(),
  })

  await recordPriceSnapshot({
    market_id: marketId,
    prices,
    reserves: reserves.slice(0, numOutcomes),
    total_liquidity: parseLeoValue(p.total_liquidity),
    block_height: block,
    recorded_at: new Date().toISOString(),
  })

  // Link IPFS metadata row (stored by question_hash at upload time) to this market
  if (questionHashRaw) await linkMetadata(marketId, questionHashRaw)
}

async function syncResolutionFromChain(programId: string, marketId: string) {
  const [tallyRaw, weightRaw] = await Promise.all([
    getMappingValue(programId, 'vote_tallies', marketId),
    getMappingValue(programId, 'vote_weight_tallies', marketId),  // v2 only, null on v1
  ])
  if (!tallyRaw) return

  const t = tallyRaw
  const outcomeBonds: Record<string, string> = {}
  for (let i = 1; i <= 8; i++) {
    const key = `outcome_${i}_bonds`
    if (t[key]) outcomeBonds[String(i)] = parseLeoValue(t[key])
  }

  // outcome_weights: only populated on v2 markets that had share-votes
  const outcomeWeights: Record<string, string> | null = weightRaw
    ? Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => {
          const key = `outcome_${i + 1}_weight`
          return [String(i + 1), parseLeoValue(weightRaw[key] ?? '0')]
        }).filter(([, v]) => v !== '0')
      )
    : null

  await upsertResolution({
    market_id: marketId,
    proposed_outcome: Number(parseLeoValue(t.winning_outcome)) || null,
    outcome_bonds: outcomeBonds,
    outcome_weights: outcomeWeights,
    total_voters: Number(parseLeoValue(t.total_voters)),
    voting_deadline: Number(parseLeoValue(t.voting_deadline)),
    dispute_deadline: Number(parseLeoValue(t.dispute_deadline)),
    disputed: false,
    finalized: t.finalized === 'true',
    updated_at: new Date().toISOString(),
  })
}

/**
 * Extract market_id from a transition.
 *
 * For create_market: market_id is computed on-chain and appears as the 2nd
 * argument in the finalize Future string, right after the nested credits
 * transfer future block. The Future value is a raw text string (not JSON).
 *
 * Example Future string fragment:
 *   arguments: [
 *     { program_id: credits.aleo, ... },
 *     5508729568763946454431202067676963110735414664099531806433384906005672470229field,
 *     ...
 *   ]
 *
 * For all other veilo functions: market_id is the first public input field.
 */
function extractMarketIdFromFuture(transition: any): string | null {
  const outputs: any[] = transition?.outputs ?? []
  const futureOutput = outputs.find((o: any) => o.type === 'future')
  const futureStr: string = futureOutput?.value ?? ''
  if (!futureStr) return null

  // Pattern 1: market_id follows the closing `}` of a nested credits future
  // e.g. buy_shares, create_market: arguments: [{ credits future }, 1234field, ...]
  const afterNested = futureStr.match(/\}\s*,\s*(\d+field)/)
  if (afterNested?.[1]) return afterNested[1]

  // Pattern 2: market_id is the first argument directly (no nested future)
  // e.g. close_market, finalize_votes: arguments: [ 1234field, ... ]
  const firstArg = futureStr.match(/arguments\s*:\s*\[\s*(\d+field)/)
  return firstArg?.[1] ?? null
}

function extractMarketId(transition: any, fnName: string): string | null {
  // For create_market the first public field input is question_hash (not market_id).
  // market_id is computed on-chain — always extract it from the Future output.
  if (fnName === 'create_market') {
    return extractMarketIdFromFuture(transition)
  }

  // Try plaintext inputs first (public inputs are readable)
  const inputs: any[] = transition?.inputs ?? []
  const fieldInput = inputs.find((inp: any) =>
    (inp.type === 'public' || inp.type === 'private') &&
    typeof inp.value === 'string' && inp.value.endsWith('field')
  )
  if (fieldInput?.value) return fieldInput.value

  // Inputs are ciphertext (all private) — extract from Future output instead.
  return extractMarketIdFromFuture(transition)
}

async function processTransition(
  programId: string,
  transition: any,
  block: number
) {
  const fnName: string = transition?.function ?? ''
  const marketId = extractMarketId(transition, fnName)

  if (!marketId) {
    console.warn(`[Indexer] Could not extract market_id for ${programId}/${fnName}`)
    return
  }

  console.log(`[Indexer] ${fnName} market=${marketId} block=${block}`)

  switch (fnName) {
    case 'create_market':
    case 'buy_shares':
    case 'sell_shares':
    case 'add_liquidity':
    case 'close_market':
    case 'cancel_market':
      await syncMarketFromChain(programId, marketId, block)
      break

    case 'vote_outcome':
    case 'vote_with_shares':    // v2 NEW
    case 'finalize_votes':
    case 'confirm_resolution':
    case 'dispute_resolution':
      await syncMarketFromChain(programId, marketId, block)
      await syncResolutionFromChain(programId, marketId)
      break

    default:
      break
  }
}

/** Re-scan a specific block range — useful for backfilling missed transactions. */
export async function reindexBlocks(from: number, to: number) {
  console.log(`[Indexer] Reindexing blocks ${from}–${to}`)
  for (let h = from; h <= to; h++) {
    const txs = await getBlockTransactions(h)
    for (const tx of txs) {
      const transitions: any[] = tx?.transaction?.execution?.transitions ?? []
      for (const transition of transitions) {
        const programId: string = transition?.program ?? ''
        if (!PROGRAM_IDS.includes(programId)) continue
        await processTransition(programId, transition, h)
      }
    }
  }
  console.log(`[Indexer] Reindex complete for blocks ${from}–${to}`)
}

export async function runIndexer() {
  console.log('[Indexer] Starting...')

  let consecutiveErrors = 0

  async function loop() {
    try {
      let cursor = await getCursor()
      const latest = await getLatestBlock()

      // On first run (cursor=0), start near the current tip instead of block 1
      if (cursor === 0) {
        cursor = Math.max(0, latest - INITIAL_LOOKBACK)
        await updateCursor(cursor)
        console.log(`[Indexer] Fresh start — beginning from block ${cursor}`)
      }

      if (latest <= cursor) {
        consecutiveErrors = 0
        return
      }

      const limit = Math.min(latest, cursor + 50) // max 50 blocks per tick
      let lastSaved = cursor

      for (let h = cursor + 1; h <= limit; h++) {
        try {
          const txs = await getBlockTransactions(h)
          for (const tx of txs) {
            const transitions: any[] = tx?.transaction?.execution?.transitions ?? []
            for (const transition of transitions) {
              const programId: string = transition?.program ?? ''
              if (!PROGRAM_IDS.includes(programId)) continue
              try {
                await processTransition(programId, transition, h)
              } catch (transitionErr) {
                console.error(`[Indexer] Transition error at block ${h}:`, transitionErr)
                // Continue — don't let one bad transition stall the indexer
              }
            }
          }
          // Save cursor after each block so restarts resume from last good point
          lastSaved = h
        } catch (blockErr) {
          console.error(`[Indexer] Block ${h} fetch error:`, blockErr)
          // Save progress up to last good block and stop this batch
          break
        }
      }

      if (lastSaved > cursor) {
        await updateCursor(lastSaved)
        if (lastSaved < latest) console.log(`[Indexer] Synced to block ${lastSaved} / ${latest}`)
      }

      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors++
      const backoff = Math.min(consecutiveErrors * 5000, 60_000)
      console.error(`[Indexer] Error (attempt ${consecutiveErrors}, retry in ${backoff}ms):`, err)
      await new Promise(r => setTimeout(r, backoff))
    }
  }

  await loop()
  setInterval(loop, 5000)
}
