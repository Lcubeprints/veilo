import { createClient } from '@supabase/supabase-js'

function makeClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
  return createClient(url, key)
}

export const db = makeClient()

export async function getCursor(): Promise<number> {
  const { data } = await db
    .from('indexer_cursor')
    .select('last_block')
    .eq('id', 'singleton')
    .single()
  return data?.last_block ?? 0
}

export async function updateCursor(block: number): Promise<void> {
  await db.from('indexer_cursor').upsert({
    id: 'singleton',
    last_block: block,
    updated_at: new Date().toISOString(),
  })
}

export async function upsertMarket(market: any): Promise<void> {
  await db.from('markets').upsert(market)
}

export async function upsertResolution(resolution: any): Promise<void> {
  await db.from('resolutions').upsert(resolution)
}

export async function recordPriceSnapshot(snapshot: any): Promise<void> {
  await db.from('price_snapshots').insert(snapshot)
}

export async function getMarket(id: string) {
  const { data } = await db.from('markets').select('*, market_metadata(*)').eq('id', id).single()
  return data
}

export async function listMarkets(filters: {
  status?: number
  category?: number
  token_type?: number
  creator?: string
  sort?: string
  limit?: number
  q?: string
}) {
  // Use inner join when doing text search so filter applies on related table
  const selectClause = filters.q
    ? '*, market_metadata!inner(*)'
    : '*, market_metadata(*)'

  let query = db.from('markets').select(selectClause)

  if (filters.status !== undefined) query = query.eq('status', filters.status)
  if (filters.category !== undefined) query = query.eq('category', filters.category)
  if (filters.token_type !== undefined) query = query.eq('token_type', filters.token_type)
  if (filters.creator !== undefined) query = query.eq('creator', filters.creator)
  if (filters.q) query = (query as any).ilike('market_metadata.question_text', `%${filters.q}%`)

  const sort = filters.sort ?? 'total_volume'
  query = query.order(sort, { ascending: false })
  query = query.limit(filters.limit ?? 50)

  const { data } = await query
  return data ?? []
}

export async function getPriceHistory(marketId: string, limit = 200) {
  const { data } = await db
    .from('price_snapshots')
    .select('*')
    .eq('market_id', marketId)
    .order('recorded_at', { ascending: true })
    .limit(limit)
  return data ?? []
}
