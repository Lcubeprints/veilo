import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Lock, XCircle } from 'lucide-react'
import { Spinner, Badge, Card, Button } from '../components/ui'
import { OutcomeProbabilityBar } from '../components/market/OutcomeProbabilityBar'
import { ProbabilityChart } from '../components/charts/ProbabilityChart'
import { TradingPanel } from '../components/trading/TradingPanel'
import { LiquidityPanel } from '../components/trading/LiquidityPanel'
import { ResolutionPanel } from '../components/resolution/ResolutionPanel'
import { fetchMarketById, fetchPriceHistory, fetchResolution } from '../hooks/useMarkets'
import { categoryLabel, formatCredits, marketStatusLabel, marketStatusColor, timeRemaining, outcomeColor } from '../lib/format'
import { getTokenLabel, getProgramId, getExplorerTxUrl, BACKEND_URL } from '../lib/config'
import { buildCloseMarketInputs, buildCancelMarketInputs } from '../lib/aleo-client'
import { useAleoTransaction } from '../hooks/useAleoTransaction'
import { useStore } from '../store/store'
import type { Market, AMMPool, PriceSnapshot, Resolution } from '../types'
import { MARKET_STATUS } from '../types'

function buildPoolFromReserves(reserves: string[], numOutcomes: number, totalLiquidity: bigint): AMMPool {
  const r = (i: number): bigint => {
    const v = reserves[i]
    return v !== undefined ? BigInt(v) : totalLiquidity / BigInt(numOutcomes)
  }
  return {
    reserve_1: r(0), reserve_2: r(1), reserve_3: r(2), reserve_4: r(3),
    reserve_5: r(4), reserve_6: r(5), reserve_7: r(6), reserve_8: r(7),
    total_liquidity: totalLiquidity,
    total_lp_shares: 0n,
    total_volume: 0n,
  }
}

export function MarketDetail() {
  const { id } = useParams<{ id: string }>()
  const [market, setMarket] = useState<Market | null>(null)
  const [priceHistory, setPriceHistory] = useState<PriceSnapshot[]>([])
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // Live prices fetched directly from chain — bypasses indexer lag
  const [livePrices, setLivePrices] = useState<number[] | null>(null)
  const [liveReserves, setLiveReserves] = useState<string[] | null>(null)
  const { currentBlock, address } = useStore()
  const { execute, status: txStatus } = useAleoTransaction()

  const fetchLivePrices = async (m: Market) => {
    try {
      const programId = getProgramId(m.token_type)
      const res = await fetch(`${BACKEND_URL}/api/markets/${m.id}/pool?programId=${programId}`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.prices)) setLivePrices(data.prices)
      if (Array.isArray(data.reserves)) setLiveReserves(data.reserves)
    } catch {}
  }

  const load = async () => {
    if (!id) return
    const [m, prices, res] = await Promise.all([
      fetchMarketById(id),
      fetchPriceHistory(id),
      fetchResolution(id),
    ])
    setMarket(m)
    setPriceHistory(prices)
    setResolution(res)
    setIsLoading(false)
    if (m) fetchLivePrices(m)
  }

  useEffect(() => {
    load()
    // Auto-refresh every 8s — frequent enough to catch indexer updates
    const interval = setInterval(load, 8_000)
    return () => clearInterval(interval)
  }, [id])

  if (isLoading) return (
    <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  )
  if (!market) return (
    <div className="max-w-7xl mx-auto px-4 py-20 text-center space-y-4">
      <p className="text-white/40">Market not found</p>
      <Link to="/markets" className="inline-flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300">
        <ArrowLeft className="w-4 h-4" /> Back to Markets
      </Link>
    </div>
  )

  const meta = market.market_metadata
  const labels = meta?.outcome_labels ?? Array.from({ length: market.num_outcomes }, (_, i) => `Outcome ${i + 1}`)

  // Live prices from chain (most accurate), fall back to latest DB snapshot, then equal distribution
  const latestSnap = priceHistory[priceHistory.length - 1]
  const prices = livePrices?.slice(0, market.num_outcomes)
    ?? latestSnap?.prices?.slice(0, market.num_outcomes)
    ?? Array(market.num_outcomes).fill(1 / market.num_outcomes)

  const tokenLabel = getTokenLabel(market.token_type)
  const tokenVariant = tokenLabel === 'ALEO' ? 'blue' : tokenLabel === 'USDCX' ? 'green' : 'purple'

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Back */}
      <Link to="/markets" className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white transition-colors w-fit">
        <ArrowLeft className="w-3.5 h-3.5" /> Markets
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: market info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Header */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge>{categoryLabel(market.category)}</Badge>
              <Badge variant={tokenVariant as any}>{tokenLabel}</Badge>
              <Badge variant="purple">{market.num_outcomes} outcomes</Badge>
              <span className={`text-xs font-medium ${marketStatusColor(market.status)}`}>
                {marketStatusLabel(market.status)}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white leading-snug">
              {meta?.question_text ?? `Market ${market.id.slice(0, 16)}...`}
            </h1>
            {meta?.description && (
              <p className="text-white/50 text-sm leading-relaxed">{meta.description}</p>
            )}
            {meta?.source_url && (
              <a href={meta.source_url} target="_blank" rel="noopener" className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
                Source <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Probability bar */}
          <Card>
            <div className="space-y-3">
              <OutcomeProbabilityBar prices={prices} labels={labels} numOutcomes={market.num_outcomes} />

              {/* Per-outcome detail */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                {prices.map((price, i) => (
                  <div
                    key={i}
                    className="text-center p-2 rounded-lg bg-white/3 border border-white/5"
                    style={{ borderColor: `${outcomeColor(i + 1)}30` }}
                  >
                    <p className="text-xs text-white/50 truncate">{labels[i]}</p>
                    <p className="text-lg font-bold" style={{ color: outcomeColor(i + 1) }}>
                      {(price * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-white/30">{(1 / price).toFixed(2)}x</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Chart */}
          <Card>
            <p className="text-sm font-medium text-white/70 mb-3">Probability History</p>
            <ProbabilityChart history={priceHistory} labels={labels} numOutcomes={market.num_outcomes} />
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Volume', value: `${formatCredits(market.total_volume)} ${tokenLabel}` },
              { label: 'Liquidity', value: `${formatCredits(market.total_liquidity)} ${tokenLabel}` },
              { label: 'Deadline', value: currentBlock > 0 ? timeRemaining(market.deadline, currentBlock) : '–' },
            ].map(({ label, value }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-white/40">{label}</p>
                <p className="text-sm font-semibold text-white mt-0.5">{value}</p>
              </Card>
            ))}
          </div>

          {/* Resolution panel */}
          {market.status !== MARKET_STATUS.ACTIVE && (
            <ResolutionPanel
              market={market}
              resolution={resolution}
              currentBlock={currentBlock}
              onAction={load}
            />
          )}
        </div>

        {/* Right: trading */}
        <div className="space-y-4">
          {/* Finalize Votes CTA — voting window closed, 3+ voters, waiting for finalization */}
          {market.status === MARKET_STATUS.PENDING_RESOLUTION &&
           resolution &&
           currentBlock > (resolution.voting_deadline ?? 0) &&
           (resolution.total_voters ?? 0) >= 3 && (
            <Card className="space-y-2 border-indigo-500/40 bg-indigo-500/5">
              <p className="text-sm font-medium text-indigo-300">Voting window has closed</p>
              <p className="text-xs text-white/50">
                {resolution.total_voters} voters participated. Click below to finalize and open the dispute window.
              </p>
              <Button
                onClick={async () => {
                  await execute({
                    programId: getProgramId(market.token_type),
                    functionName: 'finalize_votes',
                    inputs: [market.id],
                    fee: 400_000,
                  })
                  load()
                }}
                disabled={txStatus === 'pending' || txStatus === 'confirming'}
                className="w-full"
              >
                {(txStatus === 'pending' || txStatus === 'confirming') ? <Spinner size="sm" /> : null}
                Finalize Votes
              </Button>
            </Card>
          )}

          {/* Confirm Resolution CTA — dispute window expired with no dispute */}
          {market.status === MARKET_STATUS.PENDING_FINALIZATION &&
           resolution &&
           currentBlock > (resolution.dispute_deadline ?? 0) &&
           !resolution.disputed && (
            <Card className="space-y-2 border-green-500/40 bg-green-500/5">
              <p className="text-sm font-medium text-green-300">Dispute window has closed</p>
              <p className="text-xs text-white/50">No dispute was filed. Confirm to finalize the resolution.</p>
              <Button
                onClick={async () => {
                  await execute({
                    programId: getProgramId(market.token_type),
                    functionName: 'confirm_resolution',
                    inputs: [market.id],
                    fee: 400_000,
                  })
                  load()
                }}
                disabled={txStatus === 'pending' || txStatus === 'confirming'}
                className="w-full bg-green-600 hover:bg-green-500"
              >
                {(txStatus === 'pending' || txStatus === 'confirming') ? <Spinner size="sm" /> : null}
                Confirm Resolution
              </Button>
            </Card>
          )}

          {market.status === MARKET_STATUS.ACTIVE && (
            <TradingPanel
              market={market}
              pool={buildPoolFromReserves(
                liveReserves ?? latestSnap?.reserves ?? [],
                market.num_outcomes,
                BigInt(market.total_liquidity),
              )}
              onTradeSuccess={() => {
                // Immediately fetch live prices from chain (no indexer lag)
                fetchLivePrices(market)
                // Also refresh DB data in background for chart history
                load()
              }}
            />
          )}

          {market.status === MARKET_STATUS.ACTIVE && (
            <LiquidityPanel market={market} onSuccess={load} />
          )}

          {/* Cancel market — creator only, ACTIVE, before deadline, zero volume */}
          {market.status === MARKET_STATUS.ACTIVE &&
           address === market.creator &&
           currentBlock <= market.deadline && (
            <Card className="space-y-2">
              {market.total_volume > 0 ? (
                <p className="text-xs text-red-400/70">
                  Cannot cancel — this market has trading volume. Cancellation is only allowed before any trades occur.
                </p>
              ) : (
                <>
                  <p className="text-xs text-white/50">Cancel this market and allow refunds (only while no trades have occurred).</p>
                  <Button
                    onClick={async () => {
                      if (!confirm('Cancel this market? All traders will be able to claim refunds.')) return
                      const txId = await execute({
                        programId: getProgramId(market.token_type),
                        functionName: 'cancel_market',
                        inputs: buildCancelMarketInputs(market.id),
                        fee: 400_000,
                      })
                      if (txId) load()
                    }}
                    disabled={txStatus === 'pending' || txStatus === 'confirming'}
                    variant="secondary"
                    className="w-full text-red-400 border-red-400/30 hover:border-red-400/60"
                  >
                    {(txStatus === 'pending' || txStatus === 'confirming')
                      ? <Spinner size="sm" />
                      : <XCircle className="w-4 h-4" />}
                    Cancel Market
                  </Button>
                </>
              )}
            </Card>
          )}

          {/* Close market — creator only, after deadline */}
          {market.status === MARKET_STATUS.ACTIVE &&
           address === market.creator &&
           currentBlock > market.deadline && (
            <Card className="space-y-2">
              <p className="text-xs text-white/50">Market deadline has passed.</p>
              <Button
                onClick={async () => {
                  const txId = await execute({
                    programId: getProgramId(market.token_type),
                    functionName: 'close_market',
                    inputs: buildCloseMarketInputs(market.id),
                    fee: 400_000,
                  })
                  if (txId) load()
                }}
                disabled={txStatus === 'pending' || txStatus === 'confirming'}
                variant="secondary"
                className="w-full"
              >
                {(txStatus === 'pending' || txStatus === 'confirming')
                  ? <Spinner size="sm" />
                  : <Lock className="w-4 h-4" />}
                Close Market
              </Button>
            </Card>
          )}

          {/* Creator */}
          <Card>
            <p className="text-xs text-white/40 mb-2">Creator</p>
            <p className="text-xs text-white/60 break-all font-mono">
              {market.creator}
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
