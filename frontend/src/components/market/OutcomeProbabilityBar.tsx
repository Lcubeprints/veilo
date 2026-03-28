import { outcomeColor, formatPct } from '../../lib/format'

interface Props {
  prices: number[]
  labels: string[]
  numOutcomes: number
}

export function OutcomeProbabilityBar({ prices, labels, numOutcomes }: Props) {
  return (
    <div className="space-y-1.5">
      {/* Stacked bar */}
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        {prices.slice(0, numOutcomes).map((price, i) => (
          <div
            key={i}
            style={{ width: `${price * 100}%`, backgroundColor: outcomeColor(i + 1) }}
            className="transition-all duration-500"
          />
        ))}
      </div>
      {/* Labels (show max 4 on small, all on hover/detail) */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {prices.slice(0, numOutcomes).map((price, i) => (
          <span key={i} className="flex items-center gap-1 text-xs text-white/60">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: outcomeColor(i + 1) }}
            />
            <span className="truncate max-w-[80px]">{labels[i] ?? `Outcome ${i + 1}`}</span>
            <span className="font-medium text-white/80">{formatPct(price)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
