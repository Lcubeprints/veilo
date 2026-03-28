import { useEffect, useMemo } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react'
import { WalletModalProvider } from '@provablehq/aleo-wallet-adaptor-react-ui'
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo'
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield'
import { PuzzleWalletAdapter } from '@provablehq/aleo-wallet-adaptor-puzzle'
import { FoxWalletAdapter } from '@provablehq/aleo-wallet-adaptor-fox'
import { SoterWalletAdapter } from '@provablehq/aleo-wallet-adaptor-soter'
import { Network } from '@provablehq/aleo-types'
import { DecryptPermission } from '@provablehq/aleo-wallet-adaptor-core'
import { Navbar } from './components/layout/Navbar'
import { ToastProvider } from './components/ui/Toast'
import { Landing } from './pages/Landing'
import { Markets } from './pages/Markets'
import { MarketDetail } from './pages/MarketDetail'
import { CreateMarket } from './pages/CreateMarket'
import { Portfolio } from './pages/Portfolio'
import { useStore } from './store/store'
import { RPC_URL, PROGRAMS } from './lib/config'
import '@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css'

const PROGRAM_LIST = [
  ...Object.values(PROGRAMS),
  'credits.aleo',
  'test_usdcx_stablecoin.aleo',
]

function AppInner() {
  const { setCurrentBlock } = useStore()

  // Poll current block height every 10s
  useEffect(() => {
    const update = async () => {
      try {
        const res = await fetch(`${RPC_URL}/block/height/latest`)
        const height = await res.json()
        if (typeof height === 'number') setCurrentBlock(height)
      } catch {}
    }
    update()
    const interval = setInterval(update, 10_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      <div className="fixed inset-0 bg-gradient-to-br from-indigo-950/30 via-transparent to-purple-950/20 pointer-events-none" />
      <div className="relative z-10">
        <Navbar />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/markets/:id" element={<MarketDetail />} />
          <Route path="/create" element={<CreateMarket />} />
          <Route path="/portfolio" element={<Portfolio />} />
        </Routes>
      </div>
    </div>
  )
}

function App() {
  const wallets = useMemo(() => [
    new ShieldWalletAdapter(),
    new LeoWalletAdapter(),
    new PuzzleWalletAdapter(),
    new FoxWalletAdapter(),
    new SoterWalletAdapter(),
  ], [])

  return (
    <BrowserRouter>
      <AleoWalletProvider
        wallets={wallets}
        network={Network.TESTNET}
        decryptPermission={DecryptPermission.AutoDecrypt}
        programs={PROGRAM_LIST}
        autoConnect={true}
        onError={(err) => console.error('[Wallet]', err)}
      >
        <WalletModalProvider>
          <ToastProvider>
            <AppInner />
          </ToastProvider>
        </WalletModalProvider>
      </AleoWalletProvider>
    </BrowserRouter>
  )
}

export default App
