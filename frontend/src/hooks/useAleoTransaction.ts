import { useState, useCallback } from 'react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { useStore } from '../store/store'
import { useToast } from '../components/ui/Toast'
import { RPC_URL } from '../lib/config'

type TxStatus = 'idle' | 'pending' | 'confirming' | 'confirmed' | 'failed'

interface TxOptions {
  programId: string
  functionName: string
  inputs: string[]
  fee?: number
  // Indices of private records the wallet should inject (from its own scanned records).
  // Use when a transition expects a record input (e.g. credits.aleo/credits for buy_shares).
  recordIndices?: number[]
}

export function useAleoTransaction() {
  const [status, setStatus] = useState<TxStatus>('idle')
  const [txId, setTxId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { connected, executeTransaction, transactionStatus, wallet } = useWallet()
  const { addPendingTx, removePendingTx } = useStore()
  const toast = useToast()

  const execute = useCallback(async (opts: TxOptions): Promise<string | null> => {
    if (!connected) {
      setError('Wallet not connected')
      setStatus('failed')
      return null
    }

    setStatus('pending')
    setError(null)
    setTxId(null)

    try {
      const result = await executeTransaction({
        program: opts.programId,
        function: opts.functionName,
        inputs: opts.inputs,
        fee: opts.fee ?? 500_000,
        privateFee: false,
        ...(opts.recordIndices ? { recordIndices: opts.recordIndices } : {}),
      })

      const id: string = (result as any)?.transactionId ?? (result as any)?.id ?? null
      if (!id) throw new Error('No transaction ID returned')

      setTxId(id)
      setStatus('confirming')
      addPendingTx(id)

      const confirmed = await pollConfirmation(id, wallet, transactionStatus)

      removePendingTx(id)
      if (confirmed) {
        setStatus('confirmed')
        toast.success('Transaction confirmed', id.slice(0, 20) + '…')
      } else {
        setStatus('failed')
        setError('Transaction not confirmed within timeout')
        toast.error('Transaction failed', 'Not confirmed within timeout')
      }
      return confirmed ? id : null
    } catch (err: any) {
      const msg: string = err?.message ?? 'Transaction failed'
      const isCancelled = msg.toLowerCase().includes('cancelled') || msg.toLowerCase().includes('canceled') || msg.toLowerCase().includes('rejected by user') || msg.toLowerCase().includes('user rejected')
      setError(isCancelled ? null : msg)
      setStatus(isCancelled ? 'idle' : 'failed')
      if (!isCancelled) toast.error('Transaction failed', msg.slice(0, 80))
      return null
    }
  }, [connected, executeTransaction, transactionStatus, wallet, addPendingTx, removePendingTx])

  const reset = useCallback(() => {
    setStatus('idle')
    setTxId(null)
    setError(null)
  }, [])

  return { execute, status, txId, error, reset, isPending: status === 'pending' || status === 'confirming' }
}

/**
 * Shield wallet returns a transition ID (au1...) instead of a transaction ID (at1...).
 * Resolve it to a transaction ID via the Aleo REST API before polling.
 */
async function resolveTransactionId(id: string): Promise<string> {
  if (!id.startsWith('au1')) return id
  try {
    const res = await fetch(`${RPC_URL}/find/transactionID/${id}`)
    if (res.ok) {
      const txId = await res.json()
      if (typeof txId === 'string' && txId.startsWith('at1')) return txId
    }
  } catch {
    // ignore — return original id
  }
  return id
}

async function pollConfirmation(
  rawId: string,
  wallet: any,
  transactionStatus: any,
  maxAttempts = 60,
): Promise<boolean> {
  // Resolve transition ID → transaction ID (Shield wallet quirk)
  let txId = rawId
  for (let attempt = 0; attempt < 10; attempt++) {
    txId = await resolveTransactionId(rawId)
    if (txId !== rawId) break
    await sleep(3000) // wait for the transition to be indexed before retrying
  }

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(3000)
    try {
      // 1. Try the Aleo REST API directly (works with any wallet)
      const restRes = await fetch(`${RPC_URL}/transaction/${txId}`)
      if (restRes.ok) {
        const tx = await restRes.json()
        const s = (tx?.status ?? tx?.type ?? '')?.toLowerCase()
        if (s === 'accepted' || s === 'finalized' || s === 'confirmed') return true
        if (s === 'rejected' || s === 'failed' || s === 'aborted') return false
        // If tx exists at all without error, consider it confirmed
        if (tx && !tx?.error) return true
      }

      // 2. Fall back to wallet adapter status
      let statusStr: string | undefined
      if (wallet?.adapter && 'transactionStatus' in wallet.adapter) {
        const res: any = await wallet.adapter.transactionStatus(txId)
        statusStr = (typeof res === 'string' ? res : res?.status)?.toLowerCase()
      } else {
        const res = await transactionStatus(txId)
        statusStr = (res as any)?.status?.toLowerCase()
      }
      if (statusStr === 'finalized' || statusStr === 'completed' || statusStr === 'accepted') return true
      if (statusStr === 'failed' || statusStr === 'rejected') return false
    } catch {
      // Keep polling — wallet may not have started processing yet
    }
  }
  return false
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
