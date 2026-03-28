import { SECONDS_PER_BLOCK } from './config'
import { CATEGORY_LABELS, MARKET_STATUS } from '../types'

export function formatCredits(microcredits: bigint | number | string): string {
  const n = typeof microcredits === 'bigint'
    ? Number(microcredits)
    : typeof microcredits === 'string'
    ? Number(microcredits)
    : microcredits
  return (n / 1_000_000).toFixed(4)
}

export function formatUSD(microcents: bigint | number | string): string {
  const n = typeof microcents === 'bigint'
    ? Number(microcents)
    : typeof microcents === 'string'
    ? Number(microcents)
    : microcents
  return `$${(n / 1_000_000).toFixed(2)}`
}

export function formatPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

export function blocksToMs(blocks: number): number {
  return blocks * SECONDS_PER_BLOCK * 1000
}

export function timeRemaining(deadlineBlock: number, currentBlock: number): string {
  const blocksLeft = deadlineBlock - currentBlock
  if (blocksLeft <= 0) return 'Ended'
  const seconds = blocksLeft * SECONDS_PER_BLOCK
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function marketStatusLabel(status: number): string {
  const labels: Record<number, string> = {
    1: 'Active',
    2: 'Closed',
    3: 'Resolved',
    4: 'Cancelled',
    5: 'Voting',
    6: 'Dispute Window',
    7: 'Disputed',
  }
  return labels[status] ?? 'Unknown'
}

export function marketStatusColor(status: number): string {
  switch (status) {
    case MARKET_STATUS.ACTIVE: return 'text-green-400'
    case MARKET_STATUS.RESOLVED: return 'text-blue-400'
    case MARKET_STATUS.CANCELLED: return 'text-red-400'
    case MARKET_STATUS.PENDING_RESOLUTION:
    case MARKET_STATUS.PENDING_FINALIZATION: return 'text-yellow-400'
    default: return 'text-gray-400'
  }
}

export function categoryLabel(cat: number): string {
  return CATEGORY_LABELS[cat] ?? 'Other'
}

export function shortenAddress(addr: string, chars = 6): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`
}

// Outcome color palette (8 distinct colors)
export const OUTCOME_COLORS = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#f97316', // orange
  '#14b8a6', // teal
]

export function outcomeColor(outcome: number): string {
  return OUTCOME_COLORS[(outcome - 1) % OUTCOME_COLORS.length]
}
