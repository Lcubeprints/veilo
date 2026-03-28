import { outcomeColor, formatPct } from '../../lib/format'
import { cn } from '../ui'

interface Props {
  numOutcomes: number
  labels: string[]
  prices: number[]
  selected: number
  onSelect: (outcome: number) => void
}

export function OutcomeSelector({ numOutcomes, labels, prices, selected, onSelect }: Props) {
  // Use a 2-column grid for 2–4 outcomes, 4-column for 5–8
  const cols = numOutcomes <= 4 ? 2 : 4

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${Math.min(cols, numOutcomes)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: numOutcomes }, (_, i) => {
        const outcome = i + 1
        const isSelected = selected === outcome
        const color = outcomeColor(outcome)
        const label = labels[i] ?? `Outcome ${outcome}`
        const price = prices[i] ?? 1 / numOutcomes

        return (
          <button
            key={outcome}
            onClick={() => onSelect(outcome)}
            className={cn(
              'flex flex-col items-center gap-1 p-2.5 rounded-lg border text-sm font-medium transition-all',
              isSelected
                ? 'border-current text-current bg-current/10'
                : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white/80'
            )}
            style={isSelected ? { borderColor: color, color, backgroundColor: `${color}18` } : {}}
          >
            <span className="truncate w-full text-center text-xs leading-tight" title={label}>
              {label}
            </span>
            <span
              className="text-lg font-bold"
              style={{ color: isSelected ? color : undefined }}
            >
              {formatPct(price)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
