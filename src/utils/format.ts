import { UNKNOWN } from '../constants/common'

/**
 * 统一 token 数格式化：≥1M → `x.xM`，≥1K → `x.xK`，其余原值。
 */
export function formatTokens(n: number | null | undefined, fallback: string = UNKNOWN): string {
  if (!Number.isFinite(n)) return fallback
  const v = n as number
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}
