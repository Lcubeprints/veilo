import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Upload } from 'lucide-react'
import { Button, Card, Input, Spinner } from '../components/ui'
import { useAleoTransaction } from '../hooks/useAleoTransaction'
import { buildCreateMarketInputs, hashQuestion } from '../lib/aleo-client'
import { getProgramId, BACKEND_URL, SECONDS_PER_BLOCK, RPC_URL } from '../lib/config'
import { useStore } from '../store/store'
import type { TokenType } from '../types'

const CATEGORIES = [
  { value: 1, label: 'Politics' },
  { value: 2, label: 'Sports' },
  { value: 3, label: 'Crypto' },
  { value: 4, label: 'Entertainment' },
  { value: 5, label: 'Other' },
]

const TOKENS: { value: TokenType; label: string }[] = [
  { value: 'ALEO', label: 'ALEO' },
  { value: 'USDCX', label: 'USDCX' },
  { value: 'USAD', label: 'USAD' },
]

export function CreateMarket() {
  const navigate = useNavigate()
  const { address, currentBlock } = useStore()
  const { execute, status, error } = useAleoTransaction()

  const [question, setQuestion] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(1)
  const [token, setToken] = useState<TokenType>('ALEO')
  const [labels, setLabels] = useState(['Yes', 'No'])
  const [deadlineDays, setDeadlineDays] = useState('7')
  const [resolutionDays, setResolutionDays] = useState('14')
  const [liquidity, setLiquidity] = useState('10')
  const [sourceUrl, setSourceUrl] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  const numOutcomes = labels.length

  const addLabel = () => {
    if (labels.length < 8) setLabels([...labels, `Outcome ${labels.length + 1}`])
  }
  const removeLabel = (i: number) => {
    if (labels.length > 2) setLabels(labels.filter((_, idx) => idx !== i))
  }
  const updateLabel = (i: number, val: string) => {
    const next = [...labels]
    next[i] = val
    setLabels(next)
  }

  const handleCreate = async () => {
    if (!address || !question.trim()) return
    if (labels.some(l => !l.trim())) { alert('All outcome labels must be non-empty'); return }

    setIsUploading(true)

    // 1. Upload metadata to IPFS
    // We first generate a temporary hash of the question text to get a stable key,
    // then re-hash the CID once we have it. The final questionHash (hash of cid)
    // is what goes on-chain and is used to link metadata to the market_id later.
    let cid = ''
    let questionHash = ''
    try {
      // Pre-compute hash from question text as a placeholder to get the upload started
      const res = await fetch(`${BACKEND_URL}/api/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_text: question, description, outcome_labels: labels, source_url: sourceUrl }),
      })
      const data = await res.json()
      cid = data.cid

      // 2. Hash the CID → this becomes the on-chain question_hash
      questionHash = await hashQuestion(cid)

      // 3. Update the stored metadata row with the real question_hash
      await fetch(`${BACKEND_URL}/api/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_hash: questionHash,
          question_text: question,
          description,
          outcome_labels: labels,
          source_url: sourceUrl,
        }),
      })
    } catch {
      alert('Failed to upload metadata to IPFS')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    // 3. Convert days → block height (fetch live block at submission time to avoid stale store)
    let freshBlock = currentBlock
    try {
      const bh = await fetch(`${RPC_URL}/block/height/latest`).then(r => r.json())
      if (typeof bh === 'number' && bh > 0) freshBlock = bh
    } catch {}
    if (freshBlock === 0) { alert('Could not fetch current block height. Please try again.'); return }
    const deadlineBlock = freshBlock + Math.floor(Number(deadlineDays) * 86400 / SECONDS_PER_BLOCK)
    const resolutionBlock = freshBlock + Math.floor(Number(resolutionDays) * 86400 / SECONDS_PER_BLOCK)

    const liqNum = Number(liquidity)
    if (!Number.isFinite(liqNum) || liqNum <= 0) { alert('Invalid liquidity amount'); return }
    const liquidityMicro = BigInt(Math.floor(liqNum * 1_000_000))

    const programId = getProgramId(token)

    const txId = await execute({
      programId,
      functionName: 'create_market',
      inputs: buildCreateMarketInputs({
        questionHash,
        category,
        numOutcomes,
        deadline: deadlineBlock,
        resolutionDeadline: resolutionBlock,
        resolver: address,
        initialLiquidity: liquidityMicro,
      }),
      fee: 1_000_000,
    })

    if (txId) navigate('/markets')
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-white">Create Market</h1>

      <Card className="space-y-4">
        {/* Question */}
        <Input
          label="Question"
          value={question}
          onChange={setQuestion}
          placeholder="Will BTC exceed $150,000 by July 2026?"
        />
        <Input
          label="Description (optional)"
          value={description}
          onChange={setDescription}
          placeholder="Additional context..."
        />

        {/* Category */}
        <div className="space-y-1">
          <label className="text-sm text-white/60">Category</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={`px-3 py-1 rounded-lg text-sm border transition-all ${
                  category === c.value
                    ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                    : 'border-white/10 text-white/50 hover:border-white/20'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Token */}
        <div className="space-y-1">
          <label className="text-sm text-white/60">Market Token</label>
          <div className="flex gap-2">
            {TOKENS.map(t => (
              <button
                key={t.value}
                onClick={() => setToken(t.value)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                  token === t.value
                    ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                    : 'border-white/10 text-white/50 hover:border-white/20'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Outcomes (2–8) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-white/60">Outcomes ({numOutcomes}/8)</label>
            {numOutcomes < 8 && (
              <button onClick={addLabel} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
                <Plus className="w-3 h-3" /> Add outcome
              </button>
            )}
          </div>
          <div className="space-y-2">
            {labels.map((label, i) => (
              <div key={i} className="flex gap-2 items-center">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#f97316','#14b8a6'][i] }}
                />
                <input
                  value={label}
                  onChange={e => updateLabel(i, e.target.value)}
                  placeholder={`Outcome ${i + 1}`}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-indigo-500"
                />
                {labels.length > 2 && (
                  <button onClick={() => removeLabel(i)} className="text-white/20 hover:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Deadlines */}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Trading deadline (days)" type="number" value={deadlineDays} onChange={setDeadlineDays} min="1" />
          <Input label="Resolution deadline (days)" type="number" value={resolutionDays} onChange={setResolutionDays} min="2" />
        </div>

        {/* Liquidity */}
        <Input
          label={`Initial liquidity (${token})`}
          type="number"
          value={liquidity}
          onChange={setLiquidity}
          min="10"
          placeholder="10"
        />

        {/* Source */}
        <Input label="Source URL (optional)" value={sourceUrl} onChange={setSourceUrl} placeholder="https://..." />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <Button
          onClick={handleCreate}
          disabled={!address || !question.trim() || status === 'pending' || status === 'confirming' || isUploading}
          className="w-full"
          size="lg"
          type="submit"
        >
          {isUploading ? (
            <><Spinner size="sm" /> Uploading to IPFS...</>
          ) : status === 'pending' || status === 'confirming' ? (
            <><Spinner size="sm" /> {status === 'pending' ? 'Signing...' : 'Confirming...'}</>
          ) : (
            <><Upload className="w-4 h-4" /> Create Market</>
          )}
        </Button>

        {!address && (
          <p className="text-xs text-center text-white/40">Connect wallet to create a market</p>
        )}
      </Card>
    </div>
  )
}
