import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import marketsRoute from './routes/markets.js'
import pricesRoute from './routes/prices.js'
import simulateRoute from './routes/simulate.js'
import metadataRoute from './routes/metadata.js'
import { runIndexer, reindexBlocks } from './indexer.js'
import { getCursor, updateCursor } from './services/supabase.js'
import { getMappingScalar } from './services/aleo-rpc.js'

const app = new Hono()

app.use('*', cors({ origin: '*' }))
app.use('*', logger())

app.route('/api/markets', marketsRoute)
app.route('/api/markets', pricesRoute)
app.route('/api/markets', simulateRoute)
app.route('/api/metadata', metadataRoute)

app.get('/api/health', async (c) => {
  const cursor = await getCursor()
  return c.json({
    status: 'ok',
    last_block: cursor,
    programs: {
      v1_aleo: process.env.PROGRAM_ID_ALEO ?? 'veilo_market_v1.aleo',
      v1_usdcx: process.env.PROGRAM_ID_USDCX ?? 'veilo_market_usdcx_v1.aleo',
      v1_usad: process.env.PROGRAM_ID_USAD ?? 'veilo_market_usad_v1.aleo',
      v2_aleo: process.env.PROGRAM_ID_V2_ALEO ?? 'veilo_market_v2.aleo',
      v2_usdcx: process.env.PROGRAM_ID_V2_USDCX ?? 'veilo_market_usdcx_v2.aleo',
      v2_usad: process.env.PROGRAM_ID_V2_USAD ?? 'veilo_market_usad_v2.aleo',
    },
    network: process.env.NETWORK ?? 'testnet',
    timestamp: new Date().toISOString(),
  })
})

// GET /api/voter-rewards/:address  — pending voter reward claimable by address (voter_rewards mapping)
app.get('/api/voter-rewards/:address', async (c) => {
  const address = c.req.param('address')
  if (!address.startsWith('aleo1')) return c.json({ error: 'Invalid address' }, 400)

  const programIds = [
    process.env.PROGRAM_ID_ALEO ?? 'veilo_market_v1.aleo',
    process.env.PROGRAM_ID_USDCX ?? 'veilo_market_usdcx_v1.aleo',
    process.env.PROGRAM_ID_USAD ?? 'veilo_market_usad_v1.aleo',
    process.env.PROGRAM_ID_V2_ALEO ?? 'veilo_market_v2.aleo',
    process.env.PROGRAM_ID_V2_USDCX ?? 'veilo_market_usdcx_v2.aleo',
    process.env.PROGRAM_ID_V2_USAD ?? 'veilo_market_usad_v2.aleo',
  ]

  const rewards: Record<string, string> = {}
  await Promise.all(programIds.map(async (pid) => {
    const val = await getMappingScalar(pid, 'voter_rewards', address)
    if (val && val !== '0') rewards[pid] = val
  }))

  return c.json({ rewards })
})

// GET /api/oracle-profile/:address  — v2 oracle accuracy profile + pending bonus
app.get('/api/oracle-profile/:address', async (c) => {
  const address = c.req.param('address')
  if (!address.startsWith('aleo1')) return c.json({ error: 'Invalid address' }, 400)

  const v2Programs = [
    process.env.PROGRAM_ID_V2_ALEO ?? 'veilo_market_v2.aleo',
    process.env.PROGRAM_ID_V2_USDCX ?? 'veilo_market_usdcx_v2.aleo',
    process.env.PROGRAM_ID_V2_USAD ?? 'veilo_market_usad_v2.aleo',
  ]

  const results = await Promise.all(v2Programs.map(async (pid) => {
    const [profileRaw, bonusRaw] = await Promise.all([
      getMappingScalar(pid, 'oracle_profiles', address),
      getMappingScalar(pid, 'oracle_pending_bonus', address),
    ])
    return { pid, profile: profileRaw, pending_bonus: bonusRaw ?? '0' }
  }))

  // Return profiles keyed by programId; null if address has no profile yet
  const profiles: Record<string, { profile: any; pending_bonus: string }> = {}
  for (const r of results) {
    if (r.profile) profiles[r.pid] = { profile: r.profile, pending_bonus: r.pending_bonus }
  }

  return c.json({ profiles })
})

// POST /api/admin/reindex?from=123&to=456  — re-scan a block range
app.post('/api/admin/reindex', async (c) => {
  const from = Number(c.req.query('from'))
  const to = Number(c.req.query('to'))
  if (!from || !to || from > to) return c.json({ error: 'Invalid from/to params' }, 400)
  // Run in background, don't await
  reindexBlocks(from, to).catch((err: unknown) => console.error('[Reindex]', err))
  return c.json({ status: 'started', from, to })
})

// POST /api/admin/reset-cursor?block=123  — manually set cursor
app.post('/api/admin/reset-cursor', async (c) => {
  const block = Number(c.req.query('block') ?? '0')
  await updateCursor(block)
  return c.json({ status: 'ok', cursor: block })
})

const PORT = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[Veilo Backend] Running on http://localhost:${PORT}`)
  runIndexer()
})
