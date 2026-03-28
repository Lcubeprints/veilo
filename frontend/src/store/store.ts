import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Market, MarketMetadata, AMMPool, OutcomeShare, LPToken, Resolution } from '../types'
import { BACKEND_URL } from '../lib/config'

interface Filters {
  category: number | null
  status: number | null
  token: string | null
  sort: 'total_volume' | 'deadline' | 'created_at'
  search: string
}

interface AppState {
  // Wallet
  address: string | null
  walletType: string | null
  balance: { aleo: bigint; usdcx: bigint; usad: bigint } | null

  // Markets
  markets: Market[]
  isLoadingMarkets: boolean
  selectedMarketId: string | null
  filters: Filters

  // Private records (from wallet)
  myShares: OutcomeShare[]
  myLPTokens: LPToken[]

  // Current block height (updated periodically)
  currentBlock: number

  // Pending txs
  pendingTxs: string[]

  // Actions
  setAddress: (addr: string | null, walletType?: string) => void
  setBalance: (balance: AppState['balance']) => void
  fetchMarkets: () => Promise<void>
  setSelectedMarket: (id: string | null) => void
  setFilters: (f: Partial<Filters>) => void
  setMyShares: (shares: OutcomeShare[]) => void
  setMyLPTokens: (tokens: LPToken[]) => void
  setCurrentBlock: (block: number) => void
  addPendingTx: (txId: string) => void
  removePendingTx: (txId: string) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      address: null,
      walletType: null,
      balance: null,
      markets: [],
      isLoadingMarkets: false,
      selectedMarketId: null,
      filters: { category: null, status: 1, token: null, sort: 'total_volume', search: '' },
      myShares: [],
      myLPTokens: [],
      currentBlock: 0,
      pendingTxs: [],

      setAddress: (addr, walletType) => set({ address: addr, walletType: walletType ?? null }),
      setBalance: (balance) => set({ balance }),

      fetchMarkets: async () => {
        set({ isLoadingMarkets: true })
        try {
          const { filters } = get()
          const params = new URLSearchParams()
          if (filters.status !== null) params.set('status', String(filters.status))
          if (filters.category !== null) params.set('category', String(filters.category))
          if (filters.token !== null) params.set('token', filters.token)
          if (filters.search) params.set('q', filters.search)
          params.set('sort', filters.sort)

          const res = await fetch(`${BACKEND_URL}/api/markets?${params}`)
          const { markets } = await res.json()
          set({ markets: markets ?? [] })
        } catch (err) {
          console.error('[Store] fetchMarkets failed:', err)
        } finally {
          set({ isLoadingMarkets: false })
        }
      },

      setSelectedMarket: (id) => set({ selectedMarketId: id }),
      setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),
      setMyShares: (shares) => set({ myShares: shares }),
      setMyLPTokens: (tokens) => set({ myLPTokens: tokens }),
      setCurrentBlock: (block) => set({ currentBlock: block }),
      addPendingTx: (txId) => set(s => ({ pendingTxs: [...s.pendingTxs, txId] })),
      removePendingTx: (txId) => set(s => ({ pendingTxs: s.pendingTxs.filter(t => t !== txId) })),
    }),
    {
      name: 'veilo-store',
      partialize: (s) => ({ address: s.address, walletType: s.walletType, filters: s.filters }),
    }
  )
)
