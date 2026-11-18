const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long a saved token has left, as a lowercase caption: `expired` once the moment has come,
 * otherwise the whole days left rounded up, so a token with an hour left still reads
 * `expires in 1 day` rather than as already gone. Client-safe.
 */
export function savedTokenExpiryLabel(expiresAt: Date, now: number): string {
  const remainingMs = expiresAt.getTime() - now
  if (remainingMs <= 0) return 'expired'
  const days = Math.ceil(remainingMs / DAY_MS)
  return `expires in ${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * How long until {@link savedTokenExpiryLabel} reads differently: until the day count drops, or
 * until the token expires on its last day. `null` once it reads `expired`, which never changes.
 */
export function msUntilSavedTokenExpiryLabelChanges(expiresAt: Date, now: number): number | null {
  const remainingMs = expiresAt.getTime() - now
  if (!(remainingMs > 0)) return null
  return remainingMs - (Math.ceil(remainingMs / DAY_MS) - 1) * DAY_MS
}
