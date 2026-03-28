import { Hono } from 'hono'
import { getPriceHistory } from '../services/supabase.js'

const app = new Hono()

// GET /api/markets/:id/prices
app.get('/:id/prices', async (c) => {
  const marketId = c.req.param('id')
  const limit = Number(c.req.query('limit') ?? '200')
  const history = await getPriceHistory(marketId, limit)
  return c.json({ prices: history })
})

export default app
