import { Hono } from 'hono'
import { listMarkets, getMarket } from '../services/supabase.js'

const app = new Hono()

// GET /api/markets
app.get('/', async (c) => {
  const status = c.req.query('status')
  const category = c.req.query('category')
  const token = c.req.query('token')
  const ALLOWED_SORTS = ['total_volume', 'total_liquidity', 'created_at']
  const sortParam = c.req.query('sort') ?? ''
  const sort = ALLOWED_SORTS.includes(sortParam) ? sortParam : 'total_volume'
  const limit = Number(c.req.query('limit') ?? '50')

  const tokenTypeMap: Record<string, number> = { ALEO: 1, USDCX: 2, USAD: 3 }

  const creator = c.req.query('creator')
  const q = c.req.query('q')

  const markets = await listMarkets({
    status: status ? Number(status) : undefined,
    category: category ? Number(category) : undefined,
    token_type: token ? tokenTypeMap[token.toUpperCase()] : undefined,
    creator: creator || undefined,
    q: q || undefined,
    sort,
    limit,
  })

  return c.json({ markets })
})

// GET /api/markets/trending
app.get('/trending', async (c) => {
  const markets = await listMarkets({ sort: 'total_volume', status: 1, limit: 6 })
  return c.json({ markets })
})

// GET /api/markets/:id
app.get('/:id', async (c) => {
  const market = await getMarket(c.req.param('id'))
  if (!market) return c.json({ error: 'Market not found' }, 404)
  return c.json({ market })
})

export default app
