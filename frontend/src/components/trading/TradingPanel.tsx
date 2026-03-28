import { useState, useEffect } from 'react'
import { Zap, AlertCircle } from 'lucide-react'
import { Button, Card, Input, Spinner } from '../ui'
import { OutcomeSelector } from './OutcomeSelector'
import { outcomeColor, formatCredits, formatPct } from '../../lib/format'
import { getProgramId, getTokenLabel } from '../../lib/config'
import { getAllPrices } from '../../lib/amm'
import { buildBuySharesInputs, buildSellSharesInputs, randomFieldNonce } from '../../lib/aleo-client'
import { RPC_URL } from '../../lib/config'
import { fetchParsedRecords } from '../../lib/records'
import { useAleoTransaction } from '../../hooks/useAleoTransaction'
import { simulateTrade } from '../../hooks/useMarkets'
import { useStore } from '../../store/store'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import type { Market, AMMPool } from '../../types'

interface Props {
  market: Market
  pool: AMMPool
  onTradeSuccess?: () => void
}

export function TradingPanel({ market, pool, onTradeSuccess }: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [selectedOutcome, setSelectedOutcome] = useState<number>(1)
  const [amount, setAmount] = useState('')
  const [simulation, setSimulation] = useState<any>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)
  // outcome index (1-based) → available share quantity
  const [ownedShares, setOwnedShares] = useState<Record<number, bigint>>({})
  const [isLoadingShares, setIsLoadingShares] = useState(false)

  const { execute, status } = useAleoTransaction()
  const { address } = useStore()
  const { wallet } = useWallet()

  const meta = market.market_metadata
  const labels = meta?.outcome_labels ?? Array.from({ length: market.num_outcomes }, (_, i) => `Outcome ${i + 1}`)
  const prices = getAllPrices({ ...pool, num_outcomes: market.num_outcomes })
  const programId = getProgramId(market.token_type)
  const tokenLabel = getTokenLabel(market.token_type)

  // Load owned shares when switching to sell tab
  useEffect(() => {
    if (side !== 'sell' || !address) { setOwnedShares({}); return }
    setIsLoadingShares(true)
    fetchParsedRecords((wallet?.adapter as any), programId)
      .then(records => {
        const balances: Record<number, bigint> = {}
        const myId = market.id.replace(/field$/, '')
        for (const r of records) {
          const { outcome, quantity, market_id } = r.fields
          if (!outcome || !quantity) continue
          const mid = (market_id ?? '').replace(/field$/, '')
          if (mid !== myId) continue
          const o = Number(outcome.replace(/u8$/, ''))
          const q = BigInt(quantity.replace(/u128$/, ''))
          balances[o] = (balances[o] ?? 0n) + q
        }
        setOwnedShares(balances)
      })
      .catch(() => {})
      .finally(() => setIsLoadingShares(false))
  }, [side, address, selectedOutcome, programId, market.id])

  // Debounced simulation
  useEffect(() => {
    if (!amount || Number(amount) <= 0) { setSimulation(null); return }
    const timeout = setTimeout(async () => {
      setIsSimulating(true)
      const result = await simulateTrade({
        marketId: market.id,
        programId,
        outcome: selectedOutcome,
        amount: Number(amount),
        side,
      })
      setSimulation(result)
      setIsSimulating(false)
    }, 400)
    return () => clearTimeout(timeout)
  }, [amount, selectedOutcome, side, market.id])

  const handleTrade = async () => {
    if (!address || !amount || !simulation) return
    setTradeError(null)
    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) { setTradeError('Invalid amount'); return }
    const amountMicro = BigInt(Math.floor(amountNum * 1_000_000))

    try {
      if (side === 'buy') {
        // Fetch the credits.aleo/credits private record from the wallet
        const creditRecords: any[] = await (wallet?.adapter as any)
          ?.requestRecords?.('credits.aleo', true) ?? []

        if (creditRecords.length === 0) {
          setTradeError(
            'No private credits record found. Open Shield wallet → use "Transfer Public to Private" to convert your public ALEO credits first.'
          )
          return
        }

        // Extract plaintext from each record, then find the first one not already spent on-chain
        const plaintexts: string[] = creditRecords
          .map((r: any) =>
            typeof r === 'string' ? r
            : r?.recordPlaintext ?? r?.plaintext
            ?? r?.recordCiphertext ?? r?.ciphertext ?? r?.id ?? null
          )
          .filter((p): p is string => typeof p === 'string')

        const creditsRecord = await findUnspentRecord(plaintexts)

        if (!creditsRecord) {
          setTradeError(
            'All private credits records are spent. In Shield wallet → use "Transfer Public to Private" to create a fresh private credits record, then try again.'
          )
          return
        }

        const sharesOut = BigInt(simulation.shares_out ?? '0')
        const minShares = (sharesOut * 95n) / 100n // 5% slippage tolerance
        const nonce = randomFieldNonce()

        const inputs = buildBuySharesInputs({
          marketId: market.id,
          outcome: selectedOutcome,
          amountIn: amountMicro,
          expectedShares: sharesOut,
          minSharesOut: minShares,
          shareNonce: nonce,
          creditsRecord,
        })

        const txId = await execute({ programId, functionName: 'buy_shares', inputs, fee: 800_000 })
        if (txId) {
          setAmount('')
          setSimulation(null)
          onTradeSuccess?.()
        }
      } else {
        // Fetch the OutcomeShare record for the selected outcome
        const shareRecords: any[] = await (wallet?.adapter as any)
          ?.requestRecords?.(programId, true) ?? []
        const myMarketId = market.id.replace(/field$/, '')
        const shareRecord: string | undefined = shareRecords
          .map((r: any) =>
            typeof r === 'string' ? r
            : r?.recordPlaintext ?? r?.plaintext ?? r?.recordCiphertext ?? r?.ciphertext ?? r?.id
          )
          .find((p: any) =>
            typeof p === 'string' &&
            p.includes(`outcome: ${selectedOutcome}u8`) &&
            p.includes(myMarketId)
          )

        if (!shareRecord) {
          setTradeError(`No share record found for outcome ${selectedOutcome}. You need to buy shares first.`)
          return
        }

        const txId = await execute({
          programId,
          functionName: 'sell_shares',
          inputs: buildSellSharesInputs({
            shareRecord,
            tokensDesired: amountMicro,
            maxSharesUsed: BigInt(simulation.shares_needed ?? '0'),
          }),
          fee: 800_000,
        })
        if (txId) {
          setAmount('')
          setSimulation(null)
          onTradeSuccess?.()
        }
      }
    } catch (err: any) {
      const msg: string = err?.message ?? 'Transaction failed'
      if (msg.toLowerCase().includes('cancelled') || msg.toLowerCase().includes('canceled') || msg.toLowerCase().includes('rejected by user') || msg.toLowerCase().includes('user rejected')) {
        // User dismissed the wallet popup — not an error
        return
      } else if (msg.includes('already exists in the ledger')) {
        setTradeError(
          'Credits record already spent. Fix: 1) Shield → Settings → Sync (wait for it to finish). 2) Shield → Transfer → Public to Private (any amount). 3) Wait ~30s for the new block, Sync again. 4) Try again.'
        )
      } else {
        setTradeError(msg)
      }
    }
  }

  const isPending = status === 'pending' || status === 'confirming'

  return (
    <Card className="space-y-4">
      {/* Buy/Sell tabs */}
      <div className="flex gap-1 bg-white/5 rounded-lg p-1">
        {(['buy', 'sell'] as const).map(s => (
          <button
            key={s}
            onClick={() => { setSide(s); setSimulation(null); setTradeError(null) }}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-all ${
              side === s ? 'bg-indigo-600 text-white' : 'text-white/50 hover:text-white'
            }`}
          >
            {s === 'buy' ? 'Buy Shares' : 'Sell Shares'}
          </button>
        ))}
      </div>

      {/* Outcome selector */}
      <div className="space-y-2">
        <p className="text-xs text-white/50">Select Outcome</p>
        <OutcomeSelector
          numOutcomes={market.num_outcomes}
          labels={labels}
          prices={prices}
          selected={selectedOutcome}
          onSelect={(o) => { setSelectedOutcome(o); setSimulation(null) }}
        />
      </div>

      {/* Available shares (sell mode only) */}
      {side === 'sell' && (
        <div className="flex items-center justify-between text-xs px-0.5">
          <span className="text-white/40">Available shares</span>
          {isLoadingShares ? (
            <Spinner size="sm" />
          ) : (
            <div className="flex items-center gap-2">
              <span
                className="font-medium"
                style={{ color: (ownedShares[selectedOutcome] ?? 0n) > 0n ? outcomeColor(selectedOutcome) : undefined }}
              >
                {(ownedShares[selectedOutcome] ?? 0n) > 0n
                  ? `${formatCredits(ownedShares[selectedOutcome])} shares`
                  : <span className="text-white/30">None</span>
                }
              </span>
            </div>
          )}
        </div>
      )}

      {/* Amount input */}
      <Input
        label={`Amount (${tokenLabel})`}
        type="number"
        value={amount}
        onChange={setAmount}
        placeholder="0.00"
        min="0"
        step="0.01"
      />

      {/* Simulation preview */}
      {isSimulating && (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Spinner size="sm" /> Calculating...
        </div>
      )}
      {simulation && !isSimulating && (
        <div className="space-y-1.5 text-sm border border-white/10 rounded-lg p-3 bg-white/3">
          {side === 'buy' ? (
            <>
              <Row label="Est. Shares" value={formatCredits(BigInt(simulation.shares_out ?? '0'))} />
              <Row label="Avg Price" value={`${(simulation.avg_price ?? 0).toFixed(4)} ${tokenLabel}`} />
              <Row label="Price Impact" value={formatPct(simulation.price_impact ?? 0)} warn={(simulation.price_impact ?? 0) > 0.05} />
              <Row label="Fee (1%)" value={formatCredits(BigInt(simulation.fees?.total ?? '0'))} />
            </>
          ) : (
            <>
              <Row
                label="Shares Needed"
                value={formatCredits(BigInt(simulation.shares_needed ?? '0'))}
                warn={
                  (ownedShares[selectedOutcome] ?? 0n) > 0n &&
                  BigInt(simulation.shares_needed ?? '0') > (ownedShares[selectedOutcome] ?? 0n)
                }
              />
              <Row label="Net Received" value={`${formatCredits(BigInt(simulation.net_tokens ?? '0'))} ${tokenLabel}`} />
              <Row label="Total Fee" value={formatCredits(BigInt(simulation.fees?.total ?? '0'))} />
            </>
          )}
        </div>
      )}

      {tradeError && (
        <div className="flex items-start gap-2 text-xs text-red-400 bg-red-400/5 border border-red-400/20 rounded-lg p-2.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{tradeError}</span>
        </div>
      )}

      <Button
        onClick={handleTrade}
        disabled={!address || !amount || !simulation || isPending}
        className="w-full"
        size="lg"
      >
        {isPending ? (
          <><Spinner size="sm" /> {status === 'pending' ? 'Signing...' : 'Confirming...'}</>
        ) : (
          <><Zap className="w-4 h-4" /> {side === 'buy' ? 'Buy Shares' : 'Sell Shares'}</>
        )}
      </Button>

      {!address && (
        <p className="text-xs text-center text-white/40">Connect wallet to trade</p>
      )}
    </Card>
  )
}

/**
 * Given a list of record plaintexts, return the first one whose serial number
 * (the `_nonce` field parsed from the plaintext) is NOT already spent on-chain.
 * Falls back to the first record if we can't determine spent status.
 */
async function findUnspentRecord(plaintexts: string[]): Promise<string | null> {
  if (plaintexts.length === 0) return null
  // Use the last record — wallet returns oldest-first, newest is most likely unspent.
  // The nonce-based check is unreliable: /find/transitionID returns the CREATION
  // transition (200) for all valid records, not just spent ones. Fresh records also
  // return 200 immediately and would be wrongly skipped.
  return plaintexts[plaintexts.length - 1]
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className={warn ? 'text-yellow-400' : 'text-white'}>{value}</span>
    </div>
  )
}
