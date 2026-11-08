import { useCallback, useState } from 'react'
import { RECENT_IMPERSONATIONS_STORAGE_KEY } from '@/stores'

const MAX_RECENT = 5

function readRecentEmails(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_IMPERSONATIONS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is string => typeof e === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

/**
 * Last {@link MAX_RECENT} emails the admin impersonated, most recent first,
 * persisted in localStorage on this browser.
 */
export function useRecentImpersonations() {
  const [recentEmails, setRecentEmails] = useState<string[]>(() => readRecentEmails())

  const recordImpersonation = useCallback((email: string) => {
    const next = [email, ...readRecentEmails().filter((e) => e !== email)].slice(0, MAX_RECENT)
    try {
      localStorage.setItem(RECENT_IMPERSONATIONS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* best-effort: recording must never block the impersonation transition */
    }
    setRecentEmails(next)
  }, [])

  return { recentEmails, recordImpersonation }
}
