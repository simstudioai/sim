import type { TraceSpan } from '@/lib/logs/types'

export function parseTime(value?: string | number | null): number {
  if (!value) return 0
  const ms = typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

export function formatTokenCount(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value.toLocaleString('en-US')
}

export function formatTtft(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatTps(
  outputTokens: number | undefined,
  durationMs: number
): string | undefined {
  if (typeof outputTokens !== 'number' || !(outputTokens > 0)) return undefined
  if (!(durationMs > 0)) return undefined
  const tps = Math.round(outputTokens / (durationMs / 1000))
  return tps > 0 ? `${tps.toLocaleString('en-US')} tok/s` : undefined
}

export function formatTokensSummary(tokens: TraceSpan['tokens']): string | undefined {
  if (!tokens) return undefined
  const parts: string[] = []
  const input = formatTokenCount(tokens.input)
  const output = formatTokenCount(tokens.output)
  const total = formatTokenCount(tokens.total)
  const cacheRead = formatTokenCount(tokens.cacheRead)
  const cacheWrite = formatTokenCount(tokens.cacheWrite)
  const reasoning = formatTokenCount(tokens.reasoning)
  if (input) parts.push(`${input} in`)
  if (cacheRead) parts.push(`${cacheRead} cached`)
  if (cacheWrite) parts.push(`${cacheWrite} cache write`)
  if (output) parts.push(`${output} out`)
  if (reasoning) parts.push(`${reasoning} reasoning`)
  if (total) parts.push(`${total} total`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
