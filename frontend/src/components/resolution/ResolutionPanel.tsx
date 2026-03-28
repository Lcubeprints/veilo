import { useState } from 'react'
import { CheckCircle, AlertTriangle, Vote, Gift, RotateCcw, Coins } from 'lucide-react'
import { Button, Card, Spinner } from '../ui'
import { formatCredits, outcomeColor } from '../../lib/format'
import { useAleoTransaction } from '../../hooks/useAleoTransaction'
import {
  buildVoteOutcomeInputs,
  buildVoteWithSharesInputsAleo,
  buildVoteWithSharesInputsToken,
  buildClaimVoterBondInputs,
  buildFinalizeVotesInputs,
  buildConfirmResolutionInputs,
  buildRedeemSharesInputs,
  buildClaimRefundInputs,
  buildDisputeResolutionInputs,
  randomFieldNonce,
} from '../../lib/aleo-client'
import { fetchParsedRecords, findUnspentCreditsRecord } from '../../lib/records'
import { getProgramId, isV2Program } from '../../lib/config'
import { useStore } from '../../store/store'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import type { Market, Resolution } from '../../types'
import { MARKET_STATUS } from '../../types'

interface Props {
  market: Market
  resolution: Resolution | null
  currentBlock: number
  onAction?: () => void
}

export function ResolutionPanel({ market, resolution, currentBlock, onAction }: Props) {
  const [selectedVoteOutcome, setSelectedVoteOutcome] = useState<number>(1)
  const [selectedDisputeOutcome, setSelectedDisputeOutcome] = useState<number>(1)
  const [actionError, setActionError] = useState<string | null>(null)
  const { execute, status } = useAleoTransaction()
  const { address } = useStore()
  const { wallet } = useWallet()

  const meta = market.market_metadata
  const labels = meta?.outcome_labels ?? Array.from({ length: market.num_outcomes }, (_, i) => `Outcome ${i + 1}`)
  const programId = getProgramId(market.token_type)
  const programIdV2 = getProgramId(market.token_type, 2)
  const marketIsV2 = isV2Program(programId)
  const adapter = (wallet?.adapter as any)

  const isActive = market.status === MARKET_STATUS.ACTIVE
  const isClosed = market.status === MARKET_STATUS.CLOSED
  const isVoting = market.status === MARKET_STATUS.PENDING_RESOLUTION
  const isPendingFinalization = market.status === MARKET_STATUS.PENDING_FINALIZATION
  const isResolved = market.status === MARKET_STATUS.RESOLVED
  const isCancelled = market.status === MARKET_STATUS.CANCELLED
  const isDisputed = market.status === MARKET_STATUS.DISPUTED

  const votingWindowPassed = resolution && currentBlock > (resolution.voting_deadline ?? 0)
  const disputeWindowPassed = resolution && currentBlock > (resolution.dispute_deadline ?? 0)
  const isPending = status === 'pending' || status === 'confirming'

  if (isActive) return null

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function getCreditsRecord(): Promise<string | null> {
    const records = await fetchParsedRecords(adapter, 'credits.aleo')
    const plaintexts = records.map(r => r.plaintext)
    return findUnspentCreditsRecord(plaintexts)
  }

  async function getShareRecord(outcomeFilter?: number): Promise<string | null> {
    const records = await fetchParsedRecords(adapter, programId)
    const match = records.find(r => {
      const fields = r.fields
      if (!fields.outcome) return false
      const mid = fields.market_id?.replace(/field$/, '')
      const myId = market.id.replace(/field$/, '')
      if (mid !== myId) return false
      if (outcomeFilter !== undefined) {
        const o = Number(fields.outcome?.replace(/u8$/, '') ?? 0)
        if (o !== outcomeFilter) return false
      }
      return true
    })
    return match?.plaintext ?? null
  }

  async function getVoterBondRecord(): Promise<string | null> {
    const records = await fetchParsedRecords(adapter, programId)
    const match = records.find(r => {
      const fields = r.fields
      if (!fields.voted_outcome && !fields.bond_amount) return false
      const mid = fields.market_id?.replace(/field$/, '')
      const myId = market.id.replace(/field$/, '')
      return mid === myId
    })
    return match?.plaintext ?? null
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleVote = async () => {
    if (!address) return
    setActionError(null)
    const creditsRecord = await getCreditsRecord()
    if (!creditsRecord) {
      setActionError('No unspent private credits record found. Transfer public → private in your wallet first.')
      return
    }
    const txId = await execute({
      programId,
      functionName: 'vote_outcome',
      inputs: buildVoteOutcomeInputs({
        marketId: market.id,
        outcome: selectedVoteOutcome,
        bondNonce: randomFieldNonce(),
        creditsRecord,
      }),
      fee: 600_000,
    })
    if (txId) onAction?.()
  }

  const handleFinalize = async () => {
    setActionError(null)
    const txId = await execute({
      programId,
      functionName: 'finalize_votes',
      inputs: buildFinalizeVotesInputs(market.id),
      fee: 400_000,
    })
    if (txId) onAction?.()
  }

  const handleConfirm = async () => {
    setActionError(null)
    const txId = await execute({
      programId,
      functionName: 'confirm_resolution',
      inputs: buildConfirmResolutionInputs(market.id),
      fee: 400_000,
    })
    if (txId) onAction?.()
  }

  const handleRedeem = async () => {
    if (!address) return
    setActionError(null)
    const winningOutcome = market.winning_outcome ?? resolution?.proposed_outcome
    const shareRecord = await getShareRecord(winningOutcome)
    if (!shareRecord) {
      setActionError(`No winning share record found for outcome ${winningOutcome}. You may not hold a position on the winning outcome.`)
      return
    }
    const txId = await execute({
      programId,
      functionName: 'redeem_shares',
      inputs: buildRedeemSharesInputs(shareRecord),
      fee: 500_000,
    })
    if (txId) onAction?.()
  }

  const handleClaimRefund = async () => {
    if (!address) return
    setActionError(null)
    const shareRecord = await getShareRecord()
    if (!shareRecord) {
      setActionError('No share record found for this market. You may not have a position here.')
      return
    }
    const txId = await execute({
      programId,
      functionName: 'claim_refund',
      inputs: buildClaimRefundInputs(shareRecord),
      fee: 500_000,
    })
    if (txId) onAction?.()
  }

  const handleClaimVoterBond = async () => {
    if (!address) return
    setActionError(null)
    const receiptRecord = await getVoterBondRecord()
    if (!receiptRecord) {
      setActionError('No voter bond receipt found for this market. You may not have voted here.')
      return
    }
    const txId = await execute({
      programId,
      functionName: 'claim_voter_bond',
      inputs: buildClaimVoterBondInputs(receiptRecord),
      fee: 400_000,
    })
    if (txId) onAction?.()
  }

  const handleVoteWithShares = async () => {
    if (!address) return
    setActionError(null)
    const shareRecord = await getShareRecord(selectedVoteOutcome)
    if (!shareRecord) {
      setActionError(`No share record found for outcome ${labels[selectedVoteOutcome - 1]}. Hold shares for that outcome to vote with them.`)
      return
    }
    const bondNonce = randomFieldNonce()
    const isAleo = market.token_type === 1
    let inputs: string[]
    let txProgramId = programIdV2

    if (isAleo) {
      const creditsRecord = await getCreditsRecord()
      if (!creditsRecord) {
        setActionError('No unspent private credits record found for the 1 ALEO vote bond.')
        return
      }
      inputs = buildVoteWithSharesInputsAleo({ shareRecord, bondNonce, creditsRecord })
    } else {
      inputs = buildVoteWithSharesInputsToken({ shareRecord, bondNonce })
    }

    const txId = await execute({
      programId: txProgramId,
      functionName: 'vote_with_shares',
      inputs,
      fee: 700_000,
    })
    if (txId) onAction?.()
  }

  const handleDispute = async () => {
    if (!address) return
    setActionError(null)
    const creditsRecord = await getCreditsRecord()
    if (!creditsRecord) {
      setActionError('No unspent private credits record found. Transfer public → private in your wallet first.')
      return
    }
    // Dispute bond = 1 ALEO (same as vote bond)
    const disputeBond = 1_000_000n
    const txId = await execute({
      programId,
      functionName: 'dispute_resolution',
      inputs: buildDisputeResolutionInputs({
        marketId: market.id,
        proposedOutcome: selectedDisputeOutcome,
        disputeNonce: randomFieldNonce(),
        creditsRecord,
        disputeBond,
      }),
      fee: 600_000,
    })
    if (txId) onAction?.()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2 font-medium text-white">
        <Vote className="w-4 h-4 text-indigo-400" />
        Resolution
      </div>

      {/* Vote tally */}
      {resolution && (
        <div className="space-y-2">
          {Array.from({ length: market.num_outcomes }, (_, i) => {
            const outcome = i + 1
            const bonds = BigInt(resolution.outcome_bonds?.[String(outcome)] ?? '0')
            const totalBonded = Object.values(resolution.outcome_bonds ?? {})
              .reduce((a, b) => a + BigInt(b ?? '0'), 0n)
            const pct = totalBonded > 0n ? Number(bonds * 100n / totalBonded) : 0
            const isWinner = (market.winning_outcome ?? resolution.proposed_outcome) === outcome

            return (
              <div key={outcome} className="flex items-center gap-2">
                <span className="text-xs text-white/50 w-24 truncate">{labels[i]}</span>
                <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: outcomeColor(outcome) }}
                  />
                </div>
                <span className="text-xs text-white/50 w-16 text-right">
                  {formatCredits(bonds)} ALEO
                </span>
                {isWinner && resolution.finalized && (
                  <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                )}
              </div>
            )
          })}
          <p className="text-xs text-white/40">
            {resolution.total_voters} voter{resolution.total_voters !== 1 ? 's' : ''} ·{' '}
            {resolution.finalized ? 'Finalized' : 'Voting in progress'}
          </p>
        </div>
      )}

      {/* ── Resolved: redeem winning shares ── */}
      {isResolved && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <CheckCircle className="w-4 h-4" />
            Resolved: {labels[(market.winning_outcome ?? resolution?.proposed_outcome ?? 1) - 1]}
          </div>
          {address && (
            <Button
              onClick={handleRedeem}
              disabled={isPending}
              className="w-full bg-green-600 hover:bg-green-500"
            >
              {isPending ? <Spinner size="sm" /> : <Gift className="w-4 h-4" />}
              Redeem Winning Shares
            </Button>
          )}
          {(isResolved || (resolution?.finalized)) && address && (
            <Button
              onClick={handleClaimVoterBond}
              disabled={isPending}
              variant="secondary"
              className="w-full"
            >
              {isPending ? <Spinner size="sm" /> : <Coins className="w-4 h-4" />}
              Claim Voter Bond
            </Button>
          )}
        </div>
      )}

      {/* ── Cancelled: claim refund ── */}
      {isCancelled && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
            <AlertTriangle className="w-4 h-4" />
            Market Cancelled — Refunds Available
          </div>
          {address && (
            <Button
              onClick={handleClaimRefund}
              disabled={isPending}
              className="w-full bg-yellow-600 hover:bg-yellow-500"
            >
              {isPending ? <Spinner size="sm" /> : <RotateCcw className="w-4 h-4" />}
              Claim Refund
            </Button>
          )}
        </div>
      )}

      {/* ── Voting phase ── */}
      {(isVoting || isPendingFinalization || isClosed) && !resolution?.finalized && (
        <div className="space-y-2">
          <p className="text-xs text-white/50">Vote for winning outcome (1 ALEO bond)</p>
          <div className="grid grid-cols-2 gap-2">
            {labels.map((label, i) => (
              <button
                key={i}
                onClick={() => setSelectedVoteOutcome(i + 1)}
                className={`p-2 rounded-lg text-xs border transition-all ${
                  selectedVoteOutcome === i + 1
                    ? 'border-indigo-500 bg-indigo-500/20 text-white'
                    : 'border-white/10 text-white/50 hover:border-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button onClick={handleVote} disabled={!address || isPending} className="w-full">
            {isPending ? <Spinner size="sm" /> : null}
            Vote for {labels[selectedVoteOutcome - 1]}
          </Button>
          {marketIsV2 && address && (
            <Button
              onClick={handleVoteWithShares}
              disabled={isPending}
              variant="secondary"
              className="w-full border-purple-500/40 text-purple-300 hover:border-purple-400/60"
            >
              {isPending ? <Spinner size="sm" /> : null}
              Vote with Shares (Skin-in-the-Game)
            </Button>
          )}
        </div>
      )}

      {/* ── Finalize votes ── */}
      {isVoting && votingWindowPassed && (resolution?.total_voters ?? 0) >= 3 && (
        <Button onClick={handleFinalize} variant="secondary" className="w-full" disabled={isPending}>
          {isPending ? <Spinner size="sm" /> : null}
          Finalize Votes
        </Button>
      )}

      {/* ── Confirm resolution ── */}
      {isPendingFinalization && disputeWindowPassed && !resolution?.disputed && (
        <Button onClick={handleConfirm} variant="secondary" className="w-full" disabled={isPending}>
          {isPending ? <Spinner size="sm" /> : null}
          Confirm Resolution
        </Button>
      )}

      {/* ── Dispute window: anyone can dispute before dispute_deadline ── */}
      {isPendingFinalization && !disputeWindowPassed && !resolution?.disputed && address && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <p className="text-xs text-white/50">Disagree with the result? Dispute it (1 ALEO bond).</p>
          <div className="grid grid-cols-2 gap-2">
            {labels.map((label, i) => (
              <button
                key={i}
                onClick={() => setSelectedDisputeOutcome(i + 1)}
                className={`p-2 rounded-lg text-xs border transition-all ${
                  selectedDisputeOutcome === i + 1
                    ? 'border-orange-500 bg-orange-500/20 text-white'
                    : 'border-white/10 text-white/50 hover:border-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            onClick={handleDispute}
            disabled={isPending}
            className="w-full bg-orange-600 hover:bg-orange-500"
          >
            {isPending ? <Spinner size="sm" /> : <AlertTriangle className="w-4 h-4" />}
            Dispute — {labels[selectedDisputeOutcome - 1]}
          </Button>
        </div>
      )}

      {/* ── Disputed ── */}
      {isDisputed && (
        <div className="flex items-center gap-2 text-orange-400 text-sm">
          <AlertTriangle className="w-4 h-4" />
          Resolution disputed — awaiting arbitration
        </div>
      )}

      {(actionError || status === 'failed') && (
        <p className="text-xs text-red-400">{actionError ?? 'Transaction failed'}</p>
      )}

      {!address && (
        <p className="text-xs text-white/40">Connect wallet to interact</p>
      )}
    </Card>
  )
}
