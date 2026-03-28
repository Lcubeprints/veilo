import { Hono } from 'hono'
import { uploadToIPFS, fetchFromIPFS } from '../services/ipfs.js'
import { db } from '../services/supabase.js'

const app = new Hono()

// POST /api/metadata
// Uploads market question/outcome labels to IPFS and caches in Supabase.
// Pass question_hash (SHA-256 of cid, as a field value without suffix) so the
// indexer can later link this row to the on-chain market_id.
app.post('/', async (c) => {
  const body = await c.req.json()
  const { question_hash, question_text, description, outcome_labels, image_url, source_url } = body

  if (!question_text || !outcome_labels || !Array.isArray(outcome_labels)) {
    return c.json({ error: 'question_text and outcome_labels required' }, 400)
  }

  const ipfsData = { question_text, description, outcome_labels, image_url, source_url }
  const cid = await uploadToIPFS(ipfsData)

  if (question_hash) {
    await db.from('market_metadata').upsert({
      question_hash,
      question_text,
      description,
      outcome_labels,
      image_url,
      ipfs_cid: cid,
      source_url,
      market_id: null,
    }, { onConflict: 'question_hash' })
  }

  return c.json({ cid, ipfs_url: `https://gateway.pinata.cloud/ipfs/${cid}` })
})

// GET /api/metadata/:cid
app.get('/:cid', async (c) => {
  const cid = c.req.param('cid')
  const data = await fetchFromIPFS(cid)
  return c.json(data)
})

export default app
