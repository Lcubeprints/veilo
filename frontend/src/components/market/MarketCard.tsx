import { Link } from 'react-router-dom'
import { Clock, TrendingUp } from 'lucide-react'
import { Badge } from '../ui'
import { OutcomeProbabilityBar } from './OutcomeProbabilityBar'
import { categoryLabel, formatCredits, marketStatusLabel, marketStatusColor, timeRemaining } from '../../lib/format'
import { getTokenLabel } from '../../lib/config'
import { useStore } from '../../store/store'
import type { Market } from '../../types'
import { MARKET_STATUS } from '../../types'

interface Props {
  market: Market
  prices?: number[]
}

export function MarketCard({ market, prices }: Props) {
  const { currentBlock } = useStore()
  const meta = market.market_metadata
  const labels = meta?.outcome_labels ?? Array.from({ length: market.num_outcomes }, (_, i) => `Outcome ${i + 1}`)
  const defaultPrices = Array(market.num_outcomes).fill(1 / market.num_outcomes)
  const displayPrices = prices ?? defaultPrices

  const tokenLabel = getTokenLabel(market.token_type)
  const tokenVariant = tokenLabel === 'ALEO' ? 'blue' : tokenLabel === 'USDCX' ? 'green' : 'purple'

  return (
    <Link to={`/markets/${market.id}`} className="block">
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 hover:bg-white/8 transition-all duration-200 space-y-3 group">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex gap-2 flex-wrap">
            <Badge>{categoryLabel(market.category)}</Badge>
            <Badge variant={tokenVariant as any}>{tokenLabel}</Badge>
            {market.num_outcomes > 4 && (
              <Badge variant="purple">{market.num_outcomes} outcomes</Badge>
            )}
          </div>
          <span className={`text-xs font-medium ${marketStatusColor(market.status)}`}>
            {marketStatusLabel(market.status)}
          </span>
        </div>

        {/* Question */}
        <p className="text-white font-medium text-sm leading-snug line-clamp-2 group-hover:text-white/90">
          {meta?.question_text ?? `Market ${market.id.slice(0, 8)}...`}
        </p>

        {/* Probability bar */}
        <OutcomeProbabilityBar prices={displayPrices} labels={labels} numOutcomes={market.num_outcomes} />

        {/* Stats footer */}
        <div className="flex items-center justify-between text-xs text-white/40 pt-1">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            {formatCredits(market.total_volume)} vol
          </span>
          {market.status === MARKET_STATUS.ACTIVE && currentBlock > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeRemaining(market.deadline, currentBlock)}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
