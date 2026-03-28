import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, Layers, AlertCircle, PlusCircle, Lock, CheckCircle, XCircle, Clock, Droplets, Coins, Trophy } from 'lucide-react'
import { Card, Spinner, Button } from '../components/ui'
import { formatCredits, outcomeColor, marketStatusLabel, marketStatusColor, timeRemaining } from '../lib/format'
import { getTokenLabel, BACKEND_URL, getProgramId } from '../lib/config'
import { buildWithdrawLPResolvedInputs, buildWithdrawCreatorFeesInputs, buildClaimLPRefundInputs, buildClaimDisputeBondInputs } from '../lib/aleo-client'
import { fetchParsedRecords, parsePlaintext } from '../lib/records'
import { useAleoTransaction } from '../hooks/useAleoTransaction'
import { useStore } from '../store/store'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import type { Market, OutcomeShare, LPToken } from '../types'
import { MARKET_STATUS } from '../types'

export function Portfolio() {
  const { address, myShares, myLPTokens, setMyShares, markets, currentBlock } = useStore()
  const [isLoading, setIsLoading] = useState(false)
  const [lpTokens, setLpTokens] = useState<Array<{ plaintext: string; fields: Record<string, string> }>>([])
  const [disputeReceipts, setDisputeReceipts] = useState<Array<{ plaintext: string; fields: Record<string, string> }>>([])
  const [createdMarkets, setCreatedMarkets] = useState<Market[]>([])
  const [creatorFees, setCreatorFees] = useState<Record<string, bigint>>({})
  const [isLoadingCreated, setIsLoadingCreated] = useState(false)
  const [voterRewards, setVoterRewards] = useState<Record<string, string>>({})
  const { wallet } = useWallet()
  const { execute, status: txStatus } = useAleoTransaction()

  const loadRecords = async () => {
    if (!address) return
    setIsLoading(true)
    try {
      const programIds = [
        'veilo_market_v1.aleo',
        'veilo_market_usdcx_v1.aleo',
        'veilo_market_usad_v1.aleo',
      ]
      const allShares: OutcomeShare[] = []

      for (const pid of programIds) {
        try {
          const records: any[] = await (wallet?.adapter as any)
            ?.requestRecords?.(pid, true) ?? []

          for (const r of records) {
            let fields: Record<string, string> = {}

            if (typeof r === 'string') {
              fields = parsePlaintext(r)
            } else if (r?.recordPlaintext) {
              fields = parsePlaintext(r.recordPlaintext)
            } else if (r?.plaintext) {
              fields = parsePlaintext(r.plaintext)
            } else if (r?.data && typeof r.data === 'object') {
              for (const [k, v] of Object.entries(r.data)) {
                fields[k] = String(v).replace(/\.(private|public)$/, '')
              }
            }

            if (!fields.outcome) continue

            const tokenStr = fields.token_type?.replace(/u8$/, '') ?? '1'
            allShares.push({
              owner: fields.owner ?? address,
              market_id: fields.market_id ?? '',
              outcome: Number(fields.outcome?.replace(/u8$/, '') ?? 0),
              quantity: BigInt(fields.quantity?.replace(/u128$/, '') ?? 0),
              share_nonce: fields.share_nonce ?? '',
              token_type: tokenStr === '2' ? 2 : tokenStr === '3' ? 3 : 1,
            })
          }
        } catch {}
      }
      setMyShares(allShares)

      // Collect LP token and dispute bond records
      const allLP: Array<{ plaintext: string; fields: Record<string, string> }> = []
      const allDisputes: Array<{ plaintext: string; fields: Record<string, string> }> = []
      for (const pid of programIds) {
        try {
          const records = await fetchParsedRecords((wallet?.adapter as any), pid)
          for (const r of records) {
            if (r.fields.lp_shares && r.fields.lp_nonce) allLP.push(r)
            if (r.fields.dispute_nonce && r.fields.bond_amount) allDisputes.push(r)
          }
        } catch {}
      }
      setLpTokens(allLP)
      setDisputeReceipts(allDisputes)
    } finally {
      setIsLoading(false)
    }
  }

  const loadCreatedMarkets = async () => {
    if (!address) return
    setIsLoadingCreated(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/markets?creator=${encodeURIComponent(address)}&limit=100`)
      if (res.ok) {
        const { markets: fetched } = await res.json()
        const list: Market[] = fetched ?? []
        setCreatedMarkets(list)

        // Fetch creator fees for resolved/cancelled markets
        const fees: Record<string, bigint> = {}
        await Promise.all(
          list
            .filter(m => m.status === MARKET_STATUS.RESOLVED || m.status === MARKET_STATUS.CANCELLED)
            .map(async (m) => {
              try {
                const r = await fetch(`${BACKEND_URL}/api/markets/${m.id}/pool?programId=${getProgramId(m.token_type)}`)
                if (r.ok) {
                  const data = await r.json()
                  const fee = BigInt(data.creator_fees ?? '0')
                  if (fee > 0n) fees[m.id] = fee
                }
              } catch {}
            })
        )
        setCreatorFees(fees)
      }
    } catch {}
    finally { setIsLoadingCreated(false) }
  }

  const loadVoterRewards = async () => {
    if (!address) return
    try {
      const res = await fetch(`${BACKEND_URL}/api/voter-rewards/${address}`)
      if (res.ok) {
        const { rewards } = await res.json()
        setVoterRewards(rewards ?? {})
      }
    } catch {}
  }

  useEffect(() => {
    loadRecords()
    loadCreatedMarkets()
    loadVoterRewards()
  }, [address, wallet])

  const handleRefresh = () => {
    loadRecords()
    loadCreatedMarkets()
    loadVoterRewards()
  }

  if (!address) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 flex flex-col items-center text-white/30 gap-3">
        <Briefcase className="w-10 h-10" />
        <p>Connect wallet to view portfolio</p>
      </div>
    )
  }

  const statusIcon = (status: number) => {
    if (status === MARKET_STATUS.ACTIVE) return <Clock className="w-3.5 h-3.5" />
    if (status === MARKET_STATUS.RESOLVED) return <CheckCircle className="w-3.5 h-3.5" />
    if (status === MARKET_STATUS.CANCELLED) return <XCircle className="w-3.5 h-3.5" />
    return <Lock className="w-3.5 h-3.5" />
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Portfolio</h1>
        <button onClick={handleRefresh} className="text-sm text-indigo-400 hover:text-indigo-300">
          Refresh
        </button>
      </div>

      <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 flex gap-3 text-sm text-indigo-300">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>Your positions are private on-chain records. They are decrypted locally in your browser — never sent to any server.</p>
      </div>

      {/* ── Positions ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide">My Positions</h2>

        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner size="lg" /></div>
        ) : myShares.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-white/30 gap-2">
            <Layers className="w-8 h-8" />
            <p>No positions found</p>
            <p className="text-xs">Buy shares on any market to see them here</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-white/50">{myShares.length} position{myShares.length !== 1 ? 's' : ''}</p>
            {myShares.map((share, i) => {
              const market = markets.find(m => m.id === share.market_id)
              const question = market?.market_metadata?.question_text ?? `Market ${share.market_id.slice(0, 16)}…`
              const labels = market?.market_metadata?.outcome_labels
              const outcomeLabel = labels?.[share.outcome - 1] ?? `Outcome ${share.outcome}`
              return (
                <Link key={i} to={`/markets/${share.market_id}`}>
                  <Card className="flex items-center justify-between gap-4 hover:border-white/20 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{ backgroundColor: `${outcomeColor(share.outcome)}20`, color: outcomeColor(share.outcome) }}
                      >
                        {share.outcome}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate max-w-xs">{question}</p>
                        <p className="text-xs text-white/40">{outcomeLabel} · {getTokenLabel(share.token_type)}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-white font-medium">{formatCredits(share.quantity)} shares</p>
                    </div>
                  </Card>
                </Link>
              )
            })}
          </>
        )}
      </section>

      {/* ── LP Positions ── */}
      {lpTokens.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide">LP Positions</h2>
          {lpTokens.map((lp, i) => {
            const mid = lp.fields.market_id ?? ''
            const market = markets.find(m => m.id === mid || m.id.replace(/field$/, '') === mid.replace(/field$/, ''))
            const question = market?.market_metadata?.question_text ?? `Market ${mid.slice(0, 16)}…`
            const lpShares = BigInt(lp.fields.lp_shares?.replace(/u128$/, '') ?? '0')
            const isResolved = market?.status === MARKET_STATUS.RESOLVED

            return (
              <Card key={i} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{question}</p>
                    <p className="text-xs text-white/40 flex items-center gap-1 mt-0.5">
                      <Droplets className="w-3 h-3" />
                      {formatCredits(lpShares)} LP shares · {getTokenLabel(market?.token_type ?? 1)}
                    </p>
                  </div>
                  {isResolved && (
                    <Button
                      onClick={async () => {
                        const minOut = (lpShares * 95n) / 100n || 1n
                        await execute({
                          programId: getProgramId(market!.token_type),
                          functionName: 'withdraw_lp_resolved',
                          inputs: buildWithdrawLPResolvedInputs({ lpRecord: lp.plaintext, minTokensOut: minOut }),
                          fee: 600_000,
                        })
                      }}
                      disabled={txStatus === 'pending' || txStatus === 'confirming'}
                      variant="secondary"
                      className="flex-shrink-0 text-xs px-3 py-1.5"
                    >
                      Withdraw
                    </Button>
                  )}
                  {market?.status === MARKET_STATUS.CANCELLED && (
                    <Button
                      onClick={async () => {
                        const minOut = (lpShares * 95n) / 100n || 1n
                        await execute({
                          programId: getProgramId(market.token_type),
                          functionName: 'claim_lp_refund',
                          inputs: buildClaimLPRefundInputs({ lpRecord: lp.plaintext, minTokensOut: minOut }),
                          fee: 600_000,
                        })
                      }}
                      disabled={txStatus === 'pending' || txStatus === 'confirming'}
                      className="flex-shrink-0 text-xs px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500"
                    >
                      Claim Refund
                    </Button>
                  )}
                </div>
                {market && market.status !== MARKET_STATUS.RESOLVED && market.status !== MARKET_STATUS.CANCELLED && (
                  <p className="text-xs text-white/30">
                    Market must be resolved or cancelled to withdraw
                  </p>
                )}
              </Card>
            )
          })}
        </section>
      )}

      {/* ── Voter Rewards ── */}
      {Object.keys(voterRewards).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide">Voter Rewards</h2>
          <Card className="space-y-2">
            <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
              <Trophy className="w-4 h-4" />
              Pending Resolver Rewards
            </div>
            {Object.entries(voterRewards).map(([pid, amount]) => {
              const tokenType = pid.includes('usdcx') ? 2 : pid.includes('usad') ? 3 : 1
              return (
                <div key={pid} className="flex items-center justify-between text-sm">
                  <span className="text-white/60">{getTokenLabel(tokenType)} markets</span>
                  <span className="text-yellow-400 font-medium">{formatCredits(amount)} {getTokenLabel(tokenType)}</span>
                </div>
              )
            })}
            <p className="text-xs text-white/30 pt-1 border-t border-white/10">
              Voter rewards accumulate when you are the resolver on confirmed markets. Claiming requires a future contract upgrade.
            </p>
          </Card>
        </section>
      )}

      {/* ── Dispute Bonds ── */}
      {disputeReceipts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide">Dispute Bonds</h2>
          {disputeReceipts.map((receipt, i) => {
            const mid = receipt.fields.market_id ?? ''
            const market = markets.find(m => m.id === mid || m.id.replace(/field$/, '') === mid.replace(/field$/, ''))
            const question = market?.market_metadata?.question_text ?? `Market ${mid.slice(0, 16)}…`
            const bondAmount = BigInt(receipt.fields.bond_amount?.replace(/u128$/, '') ?? '0')
            const proposedOutcome = Number(receipt.fields.proposed_outcome?.replace(/u8$/, '') ?? 0)
            const label = market?.market_metadata?.outcome_labels?.[proposedOutcome - 1] ?? `Outcome ${proposedOutcome}`
            const isSettled = market?.status === MARKET_STATUS.RESOLVED || market?.status === MARKET_STATUS.CANCELLED
            // Dispute won = proposed outcome matches final winning outcome, or market cancelled (full refund)
            const disputeWon = !market || market.status === MARKET_STATUS.CANCELLED
              || (market.winning_outcome !== undefined
                ? market.winning_outcome === proposedOutcome
                : true /* unknown yet — allow attempt */)

            return (
              <Card key={i} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{question}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-white/40">
                        Disputed: {label} · {formatCredits(bondAmount)} ALEO bonded
                      </p>
                      {isSettled && (
                        <span className={`text-xs font-medium ${disputeWon ? 'text-green-400' : 'text-red-400'}`}>
                          · {disputeWon ? 'Won' : 'Lost'}
                        </span>
                      )}
                    </div>
                  </div>
                  {isSettled && disputeWon && (
                    <Button
                      onClick={async () => {
                        await execute({
                          programId: getProgramId(market!.token_type),
                          functionName: 'claim_dispute_bond',
                          inputs: buildClaimDisputeBondInputs(receipt.plaintext),
                          fee: 400_000,
                        })
                      }}
                      disabled={txStatus === 'pending' || txStatus === 'confirming'}
                      variant="secondary"
                      className="flex-shrink-0 text-xs px-3 py-1.5"
                    >
                      Claim Bond
                    </Button>
                  )}
                </div>
                {!isSettled && (
                  <p className="text-xs text-white/30">Bond claimable after market resolves or cancels</p>
                )}
                {isSettled && !disputeWon && (
                  <p className="text-xs text-red-400/60">Dispute was unsuccessful — bond cannot be recovered</p>
                )}
              </Card>
            )
          })}
        </section>
      )}

      {/* ── Created Markets ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide">Markets I Created</h2>
          <Link to="/create" className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
            <PlusCircle className="w-3.5 h-3.5" /> New Market
          </Link>
        </div>

        {isLoadingCreated ? (
          <div className="flex justify-center py-6"><Spinner size="sm" /></div>
        ) : createdMarkets.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-white/30 gap-2">
            <PlusCircle className="w-8 h-8" />
            <p>No markets created yet</p>
            <Link to="/create" className="text-xs text-indigo-400 hover:text-indigo-300">
              Create your first market
            </Link>
          </div>
        ) : (
          createdMarkets.map((market) => {
            const deadlinePassed = currentBlock > 0 && currentBlock > market.deadline
            const canClose = market.status === MARKET_STATUS.ACTIVE && deadlinePassed

            return (
              <Link key={market.id} to={`/markets/${market.id}`}>
                <Card className="hover:border-white/20 transition-colors cursor-pointer space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-white leading-snug">
                      {market.market_metadata?.question_text ?? `Market ${market.id.slice(0, 20)}…`}
                    </p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className={`text-xs font-medium flex items-center gap-1 ${marketStatusColor(market.status)}`}>
                        {statusIcon(market.status)}
                        {marketStatusLabel(market.status)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-white/40">
                    <span>{getTokenLabel(market.token_type)}</span>
                    <span>·</span>
                    <span>{market.num_outcomes} outcomes</span>
                    <span>·</span>
                    <span>{formatCredits(market.total_liquidity)} liquidity</span>
                    <span>·</span>
                    <span>{formatCredits(market.total_volume)} volume</span>
                  </div>

                  {market.status === MARKET_STATUS.ACTIVE && (
                    <p className="text-xs text-white/30">
                      {deadlinePassed
                        ? 'Deadline passed — close this market on the detail page'
                        : currentBlock > 0
                          ? `Closes in ${timeRemaining(market.deadline, currentBlock)}`
                          : ''}
                    </p>
                  )}

                  {canClose && (
                    <div className="flex items-center gap-1 text-xs text-yellow-400">
                      <Lock className="w-3 h-3" />
                      Ready to close — visit market to close it
                    </div>
                  )}

                  {(creatorFees[market.id] ?? 0n) > 0n && (
                    <div className="flex items-center justify-between pt-1 border-t border-white/10">
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <Coins className="w-3 h-3" />
                        {formatCredits(creatorFees[market.id])} {getTokenLabel(market.token_type)} in fees
                      </span>
                      <Button
                        onClick={async () => {
                          await execute({
                            programId: getProgramId(market.token_type),
                            functionName: 'withdraw_creator_fees',
                            inputs: buildWithdrawCreatorFeesInputs({
                              marketId: market.id,
                              expectedAmount: creatorFees[market.id],
                            }),
                            fee: 400_000,
                          })
                          loadCreatedMarkets()
                        }}
                        disabled={txStatus === 'pending' || txStatus === 'confirming'}
                        variant="secondary"
                        className="text-xs px-3 py-1.5 text-green-400 border-green-400/30"
                      >
                        Withdraw Fees
                      </Button>
                    </div>
                  )}
                </Card>
              </Link>
            )
          })
        )}
      </section>
    </div>
  )
}
