const RELATIVE_TIME = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** Both directions, since a token's expiry is usually still ahead. */
export function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const deltaMs = new Date(iso).getTime() - Date.now()
  const minutes = Math.round(deltaMs / 60_000)
  if (Math.abs(minutes) < 60) return RELATIVE_TIME.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 48) return RELATIVE_TIME.format(hours, 'hour')
  return RELATIVE_TIME.format(Math.round(hours / 24), 'day')
}
