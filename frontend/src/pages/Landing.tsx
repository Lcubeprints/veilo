import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Shield, TrendingUp, Layers } from 'lucide-react'
import { Button } from '../components/ui'
import { MarketCard } from '../components/market/MarketCard'
import { BACKEND_URL } from '../lib/config'
import type { Market } from '../types'

export function Landing() {
  const [featured, setFeatured] = useState<Market[]>([])

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/markets/trending`)
      .then(r => r.json())
      .then(({ markets }) => setFeatured((markets ?? []).slice(0, 3)))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-medium mb-6">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          Live on Aleo Testnet
        </div>
        <h1 className="text-5xl md:text-6xl font-bold text-white mb-4 leading-tight">
          Predict anything.
          <br />
          <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Privately.
          </span>
        </h1>
        <p className="text-white/50 text-lg max-w-xl mx-auto mb-8">
          Veilo is a privacy-preserving prediction market on Aleo. Your positions stay private.
          Up to 8 outcomes per market. Trade with ALEO, USDCX, or USAD.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/markets">
            <Button size="lg">
              Explore Markets <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link to="/create">
            <Button size="lg" variant="secondary">Create a Market</Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: Shield, title: 'Private Positions', desc: 'Your shares are on-chain records — only you can see them. Zero knowledge proofs protect your portfolio.' },
            { icon: TrendingUp, title: '8 Outcomes per Market', desc: 'Not just yes/no. Predict tournaments, elections, races — up to 8 outcomes with FPMM AMM pricing.' },
            { icon: Layers, title: 'Multi-Token', desc: 'Trade markets denominated in ALEO, USDCX, or USAD. Earn LP fees by providing liquidity.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-2">
              <div className="w-9 h-9 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <Icon className="w-5 h-5 text-indigo-400" />
              </div>
              <h3 className="text-white font-semibold">{title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured markets */}
      <section className="max-w-7xl mx-auto px-4 pb-20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-lg">Trending Markets</h2>
          <Link to="/markets" className="text-sm text-indigo-400 hover:text-indigo-300">View all →</Link>
        </div>
        {featured.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {featured.map(m => <MarketCard key={m.id} market={m} />)}
          </div>
        ) : (
          <div className="flex flex-col items-center py-12 text-white/30 gap-3">
            <TrendingUp className="w-8 h-8" />
            <p className="text-sm">No markets yet — <Link to="/create" className="text-indigo-400 hover:text-indigo-300">create the first one</Link></p>
          </div>
        )}
      </section>
    </div>
  )
}
