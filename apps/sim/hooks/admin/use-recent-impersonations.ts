import { useMemo } from 'react'
import { RECENT_IMPERSONATIONS_STORAGE_KEY } from '@/lib/auth/browser-storage'
import { useClientStored } from '@/hooks/use-client-stored'

const MAX_RECENT = 5

function readStoredRecentEmails(): string | null {
  try {
    return localStorage.getItem(RECENT_IMPERSONATIONS_STORAGE_KEY)
  } catch {
    return null
  }
}

function parseRecentEmails(stored: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(stored ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is string => typeof e === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

/** Puts `email` first among the recent impersonations; best-effort, so it never blocks the switch. */
function recordImpersonation(email: string) {
  const recent = parseRecentEmails(readStoredRecentEmails())
  const next = [email, ...recent.filter((e) => e !== email)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_IMPERSONATIONS_STORAGE_KEY, JSON.stringify(next))
  } catch {}
}

/**
 * Last {@link MAX_RECENT} emails the admin impersonated, most recent first, persisted in
 * localStorage on this browser. Read where it cannot break hydration; recording one is followed by
 * a full navigation, so nothing repaints from it.
 */
export function useRecentImpersonations() {
  const stored = useClientStored(readStoredRecentEmails, null)
  const recentEmails = useMemo(() => parseRecentEmails(stored), [stored])
  return { recentEmails, recordImpersonation }
}
