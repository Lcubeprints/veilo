import { useState, useEffect } from 'react'
import { Droplets, AlertCircle } from 'lucide-react'
import { Button, Card, Input, Spinner } from '../ui'
import { formatCredits } from '../../lib/format'
import { getProgramId, getTokenLabel, BACKEND_URL } from '../../lib/config'
import { buildAddLiquidityInputs, randomFieldNonce } from '../../lib/aleo-client'
import { fetchParsedRecords, findUnspentCreditsRecord } from '../../lib/records'
import { useAleoTransaction } from '../../hooks/useAleoTransaction'
import { useStore } from '../../store/store'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import type { Market } from '../../types'

interface Props {
  market: Market
  onSuccess?: () => void
}

export function LiquidityPanel({ market, onSuccess }: Props) {
  const [amount, setAmount] = useState('')
  const [simulation, setSimulation] = useState<{ lp_shares: string; pool_share_pct: number } | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { execute, status } = useAleoTransaction()
  const { address } = useStore()
  const { wallet } = useWallet()
  const programId = getProgramId(market.token_type)
  const tokenLabel = getTokenLabel(market.token_type)
  const isPending = status === 'pending' || status === 'confirming'

  // Debounced LP simulation
  useEffect(() => {
    if (!amount || Number(amount) <= 0) { setSimulation(null); return }
    const t = setTimeout(async () => {
      setIsSimulating(true)
      try {
        const res = await fetch(`${BACKEND_URL}/api/markets/${market.id}/simulate-lp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: Number(amount), programId }),
        })
        if (res.ok) setSimulation(await res.json())
      } catch {}
      setIsSimulating(false)
    }, 400)
    return () => clearTimeout(t)
  }, [amount, market.id])

  const handleAddLiquidity = async () => {
    if (!address || !amount || !simulation) return
    setError(null)

    const adapter = (wallet?.adapter as any)
    const records = await fetchParsedRecords(adapter, 'credits.aleo')
    const creditsRecord = await findUnspentCreditsRecord(records.map(r => r.plaintext))

    if (!creditsRecord) {
      setError('No unspent private credits record found. Transfer public → private in your wallet first.')
      return
    }

    const amountMicro = BigInt(Math.floor(Number(amount) * 1_000_000))
    const lpShares = BigInt(simulation.lp_shares)
    const minLpShares = (lpShares * 95n) / 100n  // 5% slippage

    const txId = await execute({
      programId,
      functionName: 'add_liquidity',
      inputs: buildAddLiquidityInputs({
        marketId: market.id,
        amount: amountMicro,
        expectedLPShares: minLpShares,
        lpNonce: randomFieldNonce(),
        creditsRecord,
      }),
      fee: 800_000,
    })

    if (txId) {
      setAmount('')
      setSimulation(null)
      onSuccess?.()
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2 font-medium text-white">
        <Droplets className="w-4 h-4 text-blue-400" />
        Add Liquidity
      </div>

      <p className="text-xs text-white/40">
        Provide liquidity to earn LP fees. You receive an LP token representing your pool share.
      </p>

      <Input
        label={`Amount (${tokenLabel})`}
        type="number"
        value={amount}
        onChange={setAmount}
        placeholder="0.00"
        min="0"
        step="0.01"
      />

      {isSimulating && (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Spinner size="sm" /> Calculating...
        </div>
      )}

      {simulation && !isSimulating && (
        <div className="space-y-1.5 text-sm border border-white/10 rounded-lg p-3 bg-white/3">
          <Row label="Est. LP Shares" value={formatCredits(BigInt(simulation.lp_shares))} />
          <Row label="Pool Share" value={`${simulation.pool_share_pct.toFixed(2)}%`} />
          <Row label="Slippage Tolerance" value="5%" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-400 bg-red-400/5 border border-red-400/20 rounded-lg p-2.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        onClick={handleAddLiquidity}
        disabled={!address || !amount || !simulation || isPending}
        className="w-full"
      >
        {isPending ? <><Spinner size="sm" /> {status === 'pending' ? 'Signing...' : 'Confirming...'}</> : <><Droplets className="w-4 h-4" /> Add Liquidity</>}
      </Button>

      {!address && <p className="text-xs text-center text-white/40">Connect wallet to add liquidity</p>}
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  )
}
