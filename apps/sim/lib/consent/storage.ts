import { deleteConsentFromStorage, getConsentFromStorage } from 'c15t'

export const CONSENT_STORAGE_CONFIG = { defaultExpiryDays: 365 } as const

const CONSENT_MAX_AGE_MS = CONSENT_STORAGE_CONFIG.defaultExpiryDays * 24 * 60 * 60 * 1000
const PENDING_CONSENT_SYNC_KEY = 'c15t:pending-consent-sync'

function hasCurrentConsent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('consentInfo' in value)) return false

  const { consentInfo } = value
  if (!consentInfo || typeof consentInfo !== 'object' || !('time' in consentInfo)) return false

  const { time } = consentInfo
  const now = Date.now()
  return (
    typeof time === 'number' &&
    Number.isFinite(time) &&
    time > 0 &&
    time <= now &&
    now - time < CONSENT_MAX_AGE_MS
  )
}

/**
 * Runs synchronously before hydration creates the consent store. c15t renews a
 * missing cookie from localStorage without checking the original consent age;
 * its storage reader preserves the SDK's encoding and cookie precedence while
 * this check enforces the renewal interval promised in our cookie policy.
 */
export function prepareConsentStorage(): void {
  if (typeof window === 'undefined') return

  try {
    if (hasCurrentConsent(getConsentFromStorage(CONSENT_STORAGE_CONFIG))) return
  } catch {
    /** Unreadable consent cannot authorize optional tracking. */
  }

  deleteConsentFromStorage(undefined, CONSENT_STORAGE_CONFIG)

  try {
    /** A deferred save must not restore consent that has just expired or disappeared. */
    window.localStorage.removeItem(PENDING_CONSENT_SYNC_KEY)
  } catch {
    /** c15t cannot restore deferred saves when localStorage is unavailable. */
  }
}
