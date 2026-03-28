export type NetworkType = 'testnet' | 'mainnet'
export type TokenType = 'ALEO' | 'USDCX' | 'USAD'

function env(key: string, fallback = '') {
  return (import.meta.env[key] as string) ?? fallback
}

export const NETWORK = env('VITE_NETWORK', 'testnet') as NetworkType
export const RPC_URL = env('VITE_RPC_URL', 'https://api.explorer.provable.com/v1/testnet')
export const EXPLORER_URL = env('VITE_EXPLORER_URL', 'https://testnet.explorer.provable.com')
export const BACKEND_URL = env('VITE_BACKEND_URL', 'http://localhost:3001')
export const SUPABASE_URL = env('VITE_SUPABASE_URL')
export const SUPABASE_ANON_KEY = env('VITE_SUPABASE_ANON_KEY')

export const PROGRAMS: Record<TokenType, string> = {
  ALEO:  env('VITE_PROGRAM_ID_ALEO',  'veilo_market_v1.aleo'),
  USDCX: env('VITE_PROGRAM_ID_USDCX', 'veilo_market_usdcx_v1.aleo'),
  USAD:  env('VITE_PROGRAM_ID_USAD',  'veilo_market_usad_v1.aleo'),
}

// v2 program IDs — used for vote_with_shares and claim_oracle_bonus
export const PROGRAMS_V2: Record<TokenType, string> = {
  ALEO:  env('VITE_PROGRAM_ID_V2_ALEO',  'veilo_market_v2.aleo'),
  USDCX: env('VITE_PROGRAM_ID_V2_USDCX', 'veilo_market_usdcx_v2.aleo'),
  USAD:  env('VITE_PROGRAM_ID_V2_USAD',  'veilo_market_usad_v2.aleo'),
}

const V2_IDS = new Set(Object.values(PROGRAMS_V2))

export function getProgramId(tokenType: TokenType | number, version: 1 | 2 = 1): string {
  const map: Record<number, TokenType> = { 1: 'ALEO', 2: 'USDCX', 3: 'USAD' }
  const key = typeof tokenType === 'number' ? (map[tokenType] ?? 'ALEO') : tokenType
  return version === 2 ? PROGRAMS_V2[key] : PROGRAMS[key]
}

export function isV2Program(programId: string): boolean {
  return V2_IDS.has(programId)
}

export function getTokenType(programId: string): TokenType {
  if (programId.includes('usdcx')) return 'USDCX'
  if (programId.includes('usad')) return 'USAD'
  return 'ALEO'
}

export function getTokenLabel(tokenType: number | TokenType): string {
  if (typeof tokenType === 'number') {
    return { 1: 'ALEO', 2: 'USDCX', 3: 'USAD' }[tokenType] ?? 'ALEO'
  }
  return tokenType
}

export function formatAmount(amount: bigint | number, tokenType: number | TokenType): string {
  const n = typeof amount === 'bigint' ? Number(amount) : amount
  const value = n / 1_000_000
  const label = getTokenLabel(tokenType)
  if (label === 'ALEO') return `${value.toFixed(4)} ALEO`
  return `$${value.toFixed(2)} ${label}`
}

export function getExplorerTxUrl(txId: string): string {
  return `${EXPLORER_URL}/transaction/${txId}`
}

// Block time estimate
export const SECONDS_PER_BLOCK = NETWORK === 'mainnet' ? 15 : 4
