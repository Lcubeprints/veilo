import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { outcomeColor, formatPct } from '../../lib/format'
import type { PriceSnapshot } from '../../types'

interface Props {
  history: PriceSnapshot[]
  labels: string[]
  numOutcomes: number
}

export function ProbabilityChart({ history, labels, numOutcomes }: Props) {
  const data = history.map(snap => {
    const row: Record<string, any> = { block: snap.block_height }
    for (let i = 0; i < numOutcomes; i++) {
      row[`o${i + 1}`] = snap.prices[i] ?? 0
    }
    return row
  })

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-white/30 text-sm">
        No price history yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis dataKey="block" tick={{ fontSize: 10, fill: '#ffffff40' }} tickLine={false} />
        <YAxis
          domain={[0, 1]}
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 10, fill: '#ffffff40' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(v, name) => [formatPct(Number(v ?? 0)), name as string]}
          contentStyle={{ background: '#1a1a2e', border: '1px solid #ffffff15', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#ffffff60' }}
        />
        {Array.from({ length: numOutcomes }, (_, i) => (
          <Line
            key={i}
            type="monotone"
            dataKey={`o${i + 1}`}
            name={labels[i] ?? `Outcome ${i + 1}`}
            stroke={outcomeColor(i + 1)}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
