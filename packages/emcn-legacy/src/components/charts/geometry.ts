/** Round a nonnegative bar scale to readable intervals, leaving headroom above its peak. */
export function resolveBarTickValues(peak: number): number[] {
  if (!Number.isFinite(peak) || peak <= 0) return [0, 1, 2, 3, 4]
  const ceiling = peak * 1.08
  const roughStep = ceiling / 4
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const multiple = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= roughStep) ?? 10
  const step = Math.max(peak >= 1 ? 1 : 0, multiple * magnitude)
  if (!Number.isFinite(ceiling) || !Number.isFinite(step) || step <= 0) return [0, peak]
  const intervals = Math.ceil(ceiling / step)
  const ticks = Array.from({ length: intervals + 1 }, (_, index) =>
    Number((index * step).toPrecision(12))
  )
  return ticks.every(Number.isFinite) ? ticks : [0, peak]
}

/**
 * Evenly spaced point indices to label, budgeting ~64px per tick and deduping the
 * collisions that rounding produces on short series.
 */
export function resolveTimeTickIndices(pointCount: number, usableWidth: number): number[] {
  const approxLabelWidth = 64
  const desired = Math.min(8, Math.max(3, Math.floor(usableWidth / approxLabelWidth)))
  const seen = new Set<number>()
  return Array.from({ length: desired }, (_, i) =>
    Math.round((i * (pointCount - 1)) / Math.max(1, desired - 1))
  ).filter((index) => {
    if (seen.has(index)) return false
    seen.add(index)
    return true
  })
}

/**
 * Tick label whose precision follows the window: clock time within a day and a half,
 * calendar day within a quarter, month beyond that.
 */
export function formatTimeTick(
  date: Date,
  spanMs: number,
  timeZone?: string,
  format: 'auto' | 'date' = 'auto'
): string {
  if (format === 'date')
    return date.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' })
  if (spanMs <= 36 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
  if (spanMs <= 90 * 24 * 60 * 60 * 1000) {
    return date.toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric' })
  }
  return date.toLocaleString('en-US', { timeZone, month: 'short', year: 'numeric' })
}

/** Milliseconds between the first and last timestamp, or 0 for a degenerate series. */
export function resolveSpanMs(points: ReadonlyArray<{ timestamp: string }>): number {
  if (points.length < 2) return 0
  const first = new Date(points[0].timestamp).getTime()
  const last = new Date(points[points.length - 1].timestamp).getTime()
  if (Number.isNaN(first) || Number.isNaN(last)) return 0
  return Math.abs(last - first)
}
