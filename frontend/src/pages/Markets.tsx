import { useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { MarketCard } from '../components/market/MarketCard'
import { Spinner } from '../components/ui'
import { useMarkets } from '../hooks/useMarkets'
import { categoryLabel } from '../lib/format'

const CATEGORIES = [1, 2, 3, 4, 5]
const TOKENS = ['ALEO', 'USDCX', 'USAD']
const STATUSES = [
  { value: null, label: 'All' },
  { value: 1, label: 'Active' },
  { value: 3, label: 'Resolved' },
]

export function Markets() {
  const { markets, isLoading, filters, setFilters } = useMarkets()
  const [searchInput, setSearchInput] = useState(filters.search ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = (value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setFilters({ search: value })
    }, 350)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Markets</h1>
        <span className="text-white/40 text-sm">{markets.length} markets</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
        <input
          type="text"
          value={searchInput}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search markets…"
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500 transition-colors text-sm"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {/* Status */}
        <div className="flex gap-1 bg-white/5 rounded-lg p-1">
          {STATUSES.map(s => (
            <button
              key={String(s.value)}
              onClick={() => setFilters({ status: s.value })}
              className={`px-3 py-1 rounded-md text-sm transition-all ${
                filters.status === s.value
                  ? 'bg-white/15 text-white'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Category */}
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilters({ category: null })}
            className={`px-3 py-1 rounded-lg text-sm border transition-all ${
              filters.category === null
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-white/10 text-white/50 hover:border-white/20'
            }`}
          >
            All
          </button>
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setFilters({ category: c })}
              className={`px-3 py-1 rounded-lg text-sm border transition-all ${
                filters.category === c
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-white/10 text-white/50 hover:border-white/20'
              }`}
            >
              {categoryLabel(c)}
            </button>
          ))}
        </div>

        {/* Token */}
        <div className="flex gap-1">
          <button
            onClick={() => setFilters({ token: null })}
            className={`px-3 py-1 rounded-lg text-sm border transition-all ${
              filters.token === null
                ? 'border-indigo-500 text-indigo-400'
                : 'border-white/10 text-white/50'
            }`}
          >
            All tokens
          </button>
          {TOKENS.map(t => (
            <button
              key={t}
              onClick={() => setFilters({ token: t })}
              className={`px-3 py-1 rounded-lg text-sm border transition-all ${
                filters.token === t
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-white/10 text-white/50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : markets.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-white/30 space-y-2">
          <Search className="w-8 h-8" />
          <p>No markets found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map(m => <MarketCard key={m.id} market={m} />)}
        </div>
      )}
    </div>
  )
}
