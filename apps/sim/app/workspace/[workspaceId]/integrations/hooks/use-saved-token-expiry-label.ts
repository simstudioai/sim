import { useEffect, useState } from 'react'
import {
  msUntilSavedTokenExpiryLabelChanges,
  savedTokenExpiryLabel,
} from '@/lib/credentials/expiry-label'

/**
 * The caption for a saved token's expiry, kept current while the page stays open: it re-reads the
 * clock when the expiry changes (a reconnect), when the day count drops, and when the token
 * expires. `undefined` when the token states no readable expiry.
 */
export function useSavedTokenExpiryLabel(expiresAt: string | undefined): string | undefined {
  const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN
  const [clock, setClock] = useState(() => ({ expiresAtMs, now: Date.now() }))
  if (!Object.is(clock.expiresAtMs, expiresAtMs)) {
    setClock({ expiresAtMs, now: Date.now() })
  }
  const { now } = clock

  useEffect(() => {
    const untilChange = msUntilSavedTokenExpiryLabelChanges(new Date(expiresAtMs), now)
    if (untilChange === null) return
    const timer = setTimeout(
      () => setClock((current) => ({ ...current, now: Date.now() })),
      untilChange
    )
    return () => clearTimeout(timer)
  }, [expiresAtMs, now])

  return Number.isFinite(expiresAtMs)
    ? savedTokenExpiryLabel(new Date(expiresAtMs), now)
    : undefined
}
