import { UNKNOWN } from '../constants/common'

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * 统一时间格式化：ISO 字符串 → `YYYY-MM-DD HH:mm:ss`（本地时区）。
 * 空/非法值返回 fallback（默认 UNKNOWN）。
 */
export function formatTime(iso: string | null | undefined, fallback: string = UNKNOWN): string {
  if (!iso) return fallback
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fallback
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/**
 * 统一时长格式化：毫秒 → `X 小时 Y 分 Z 秒`（自动降级为 分/秒）。
 * 非法/负值返回 fallback。
 */
export function formatDuration(ms: number | null | undefined, fallback: string = UNKNOWN): string {
  if (!Number.isFinite(ms) || (ms ?? 0) < 0) return fallback
  const total = Math.floor((ms ?? 0) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s} 秒`
  return `${s} 秒`
}

/** JSON 数据对象里可能的时间字段，按优先级排列 */
const TIME_KEYS = [
  'updated_at',
  'updatedAt',
  'generated_at',
  'generatedAt',
  'created_at',
  'createdAt',
]

/**
 * 统一「更新时间」兼容取值：
 * 优先读 JSON 自身时间字段（updated_at / updatedAt / generated_at / created_at 等），
 * 无有效字段时回退到文件最后修改时间（manifest mtimeMs），均无效返回 UNKNOWN。
 */
export function resolveUpdatedTime(data: unknown, fileMtimeMs?: number | null): string {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    for (const key of TIME_KEYS) {
      const v = obj[key]
      if (typeof v === 'string' && v && !Number.isNaN(Date.parse(v))) {
        return formatTime(v)
      }
    }
  }
  if (typeof fileMtimeMs === 'number' && Number.isFinite(fileMtimeMs)) {
    return formatTime(new Date(fileMtimeMs).toISOString())
  }
  return UNKNOWN
}
