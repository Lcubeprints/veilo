import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Wallet, TrendingUp, LayoutDashboard, PlusCircle, Briefcase, Menu, X } from 'lucide-react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { useWalletModal } from '@provablehq/aleo-wallet-adaptor-react-ui'
import { Button } from '../ui'
import { formatCredits } from '../../lib/format'
import { useStore } from '../../store/store'

export function Navbar() {
  const { address: walletAddress, connected, disconnect, wallet } = useWallet()
  const { setVisible } = useWalletModal()
  const { address, balance, setAddress } = useStore()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Sync wallet address into Zustand store
  useEffect(() => {
    if (connected && walletAddress) {
      setAddress(walletAddress, wallet?.adapter?.name ?? 'unknown')
    } else if (!connected) {
      setAddress(null)
    }
  }, [connected, walletAddress, wallet])

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  const connectWallet = () => setVisible(true)
  const disconnectWallet = () => { disconnect(); setAddress(null) }

  const navItems = [
    { path: '/markets', label: 'Markets', icon: LayoutDashboard },
    { path: '/portfolio', label: 'Portfolio', icon: Briefcase },
    { path: '/create', label: 'Create', icon: PlusCircle },
  ]

  return (
    <nav className="border-b border-white/10 bg-black/40 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">veilo</span>
        </Link>

        {/* Nav links — desktop */}
        <div className="hidden md:flex items-center gap-1">
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                (path === '/markets' ? pathname.startsWith('/markets') : pathname === path)
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Link>
          ))}
        </div>

        {/* Wallet + mobile burger */}
        <div className="flex items-center gap-3">
          {address && balance && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-white/50">
              <span>{formatCredits(balance.aleo)} ALEO</span>
              {balance.usdcx > 0n && <span>${formatCredits(balance.usdcx)} USDCX</span>}
            </div>
          )}
          {connected && address ? (
            <button
              onClick={disconnectWallet}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs transition-all"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              {address.slice(0, 6)}...{address.slice(-4)}
            </button>
          ) : (
            <Button onClick={connectWallet} size="sm">
              <Wallet className="w-3.5 h-3.5" />
              Connect
            </Button>
          )}

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-1.5 text-white/50 hover:text-white transition-colors"
            onClick={() => setMobileOpen(o => !o)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-white/10 bg-black/60 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-1">
            {navItems.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  (path === '/markets' ? pathname.startsWith('/markets') : pathname === path)
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}
