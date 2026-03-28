import { useEffect, useCallback } from 'react'
import { useStore } from '../store/store'
import { supabase } from '../lib/supabase'
import { BACKEND_URL } from '../lib/config'
import type { Market, PriceSnapshot, Resolution } from '../types'

export function useMarkets() {
  const { markets, isLoadingMarkets, filters, fetchMarkets, setFilters } = useStore()

  useEffect(() => {
    fetchMarkets()
  }, [filters])

  // Supabase realtime: update markets when on-chain state changes
  useEffect(() => {
    const channel = supabase
      .channel('markets-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'markets' }, () => {
        fetchMarkets()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  return { markets, isLoading: isLoadingMarkets, filters, setFilters, refresh: fetchMarkets }
}

export function useMarketDetail(marketId: string | null) {
  useEffect(() => {
    if (!marketId) return
    // Subscribe to realtime updates for this market
    const channel = supabase
      .channel(`market-${marketId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'markets',
        filter: `id=eq.${marketId}`
      }, () => { /* handled by parent re-render */ })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [marketId])
}

export async function fetchMarketById(marketId: string): Promise<Market | null> {
  const res = await fetch(`${BACKEND_URL}/api/markets/${marketId}`)
  if (!res.ok) return null
  const { market } = await res.json()
  return market
}

export async function fetchPriceHistory(marketId: string, limit = 200): Promise<PriceSnapshot[]> {
  const res = await fetch(`${BACKEND_URL}/api/markets/${marketId}/prices?limit=${limit}`)
  if (!res.ok) return []
  const { prices } = await res.json()
  return prices
}

export async function fetchResolution(marketId: string): Promise<Resolution | null> {
  const { data } = await supabase
    .from('resolutions')
    .select('*')
    .eq('market_id', marketId)
    .maybeSingle()
  return data
}

export async function simulateTrade(params: {
  marketId: string
  programId: string
  outcome: number
  amount: number
  side: 'buy' | 'sell'
}) {
  const res = await fetch(`${BACKEND_URL}/api/markets/${params.marketId}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outcome: params.outcome,
      amount: params.amount,
      side: params.side,
      programId: params.programId,
    }),
  })
  if (!res.ok) return null
  return res.json()
}
