const RPC_URL = process.env.RPC_URL ?? 'https://api.explorer.provable.com/v1/testnet'

async function rpcFetch(path: string) {
  const res = await fetch(`${RPC_URL}${path}`)
  if (!res.ok) return null
  return res.json()
}

export async function getLatestBlock(): Promise<number> {
  const data = await rpcFetch('/block/height/latest')
  return data ? Number(data) : 0
}

export async function getBlockTransactions(height: number): Promise<any[]> {
  const data = await rpcFetch(`/block/${height}/transactions`)
  return Array.isArray(data) ? data : []
}

/**
 * Parse an Aleo struct literal string into a plain JS object.
 * Input:  "{\n  creator: aleo1...,\n  status: 1u8,\n  ...\n}"
 * Output: { creator: "aleo1...", status: "1u8", ... }
 */
export function parseLeoStruct(raw: string | null): Record<string, string> | null {
  if (!raw || typeof raw !== 'string') return null
  const inner = raw.trim().replace(/^\{/, '').replace(/\}$/, '').trim()
  const result: Record<string, string> = {}
  for (const line of inner.split('\n')) {
    const trimmed = line.trim().replace(/,$/, '')
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const value = trimmed.slice(colonIdx + 1).trim()
    if (key) result[key] = value
  }
  return Object.keys(result).length > 0 ? result : null
}

export async function getMappingValue(programId: string, mapping: string, key: string): Promise<Record<string, string> | null> {
  const data = await rpcFetch(`/program/${programId}/mapping/${mapping}/${key}`)
  if (data === null || data === undefined) return null
  // RPC returns the struct as a JSON-encoded string — parse it into an object
  if (typeof data === 'string') return parseLeoStruct(data)
  if (typeof data === 'object') return data as Record<string, string>
  return null
}

export function parseLeoValue(raw: string | null): string {
  if (!raw) return '0'
  // Strip Leo type suffixes: 100u128 → '100', true → 'true', etc.
  return raw.replace(/u\d+$/, '').replace(/field$/, '').replace(/bool$/, '')
}

export function parseLeoField(raw: string | null): string {
  if (!raw) return '0field'
  return raw.trim()
}

export function getTokenTypeFromProgramId(programId: string): number {
  if (programId.includes('usdcx')) return 2
  if (programId.includes('usad')) return 3
  return 1
}

/**
 * Fetch a mapping value that is a simple scalar (u128, bool, u8, etc.)
 * rather than a struct. Returns the numeric/string value with type suffix stripped.
 */
export async function getMappingScalar(programId: string, mapping: string, key: string): Promise<string | null> {
  const res = await fetch(`${RPC_URL}/program/${programId}/mapping/${mapping}/${encodeURIComponent(key)}`)
  if (!res.ok) return null
  const raw = await res.text()
  // Response is a JSON-encoded string like "\"1000000u128\"" or just "null"
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || parsed === undefined) return null
    const str = String(parsed).trim()
    return str.replace(/u\d+$/, '').replace(/field$/, '')
  } catch {
    return null
  }
}
