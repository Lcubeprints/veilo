/**
 * Utilities for fetching and parsing private wallet records.
 * Works with Shield, Leo, and Puzzle wallets.
 */

/** Parse a Leo record plaintext string into a flat key→value map.
 *  Strips type suffixes (.private/.public) and Leo type suffixes (u8, u128, field, etc.)
 */
export function parsePlaintext(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  const re = /(\w+)\s*:\s*([^\n,{}]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const key = m[1].trim()
    const val = m[2].trim().replace(/\.(private|public)$/, '').replace(/,$/, '').trim()
    if (key && val) result[key] = val
  }
  return result
}

/** Extract plaintext string from a raw wallet record object (any wallet format). */
export function extractPlaintext(r: any): string | null {
  if (typeof r === 'string') return r
  if (r?.recordPlaintext) return r.recordPlaintext  // Shield
  if (r?.plaintext) return r.plaintext               // Leo/Puzzle string form
  // Leo/Puzzle object form: r.data has fields as { key: "value.private" }
  if (r?.data && typeof r.data === 'object') {
    const parts: string[] = []
    for (const [k, v] of Object.entries(r.data)) {
      parts.push(`${k}: ${v}`)
    }
    return parts.join('\n')
  }
  return null
}

/** Fetch all records for a program from the wallet adapter and return parsed field maps. */
export async function fetchParsedRecords(
  walletAdapter: any,
  programId: string,
): Promise<Array<{ plaintext: string; fields: Record<string, string> }>> {
  const raw: any[] = await walletAdapter?.requestRecords?.(programId, true) ?? []
  const result: Array<{ plaintext: string; fields: Record<string, string> }> = []
  for (const r of raw) {
    const pt = extractPlaintext(r)
    if (!pt) continue
    result.push({ plaintext: pt, fields: parsePlaintext(pt) })
  }
  return result
}

/** Strip Leo type suffixes from a value string: "2u8" → "2", "123field" → "123field" */
export function stripSuffix(val: string): string {
  return val.replace(/\.(private|public)$/, '').trim()
}

/**
 * From a list of credits record plaintexts, return the first one that is
 * not already spent on-chain (checked via the Aleo REST API _nonce lookup).
 * Falls back to first record if none can be verified.
 */
export async function findUnspentCreditsRecord(plaintexts: string[]): Promise<string | null> {
  if (plaintexts.length === 0) return null
  // Return the last record — wallet returns records oldest-first, so the newest
  // (most likely unspent after a fresh transfer) is at the end.
  // The wallet's requestRecords(program, true) is responsible for filtering spent records
  // after a proper sync. Nonce-based on-chain checking is unreliable because
  // /find/transitionID returns the CREATION transition (not spending), so fresh
  // unspent records also return 200 and get incorrectly skipped.
  return plaintexts[plaintexts.length - 1]
}
