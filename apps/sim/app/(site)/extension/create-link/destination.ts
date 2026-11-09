import { simLinkDraftDestination } from '@sim/browser-extension-protocol'
import { isRecordLike } from '@sim/utils/object'

const KEY = 'sim-link-sign-in-draft'
const MAX_AGE_MS = 10 * 60_000

function fragmentDestination() {
  const value = new URLSearchParams(location.hash.slice(1)).get('url')
  return simLinkDraftDestination(value ?? '')
}

/** Only the sanitized address survives same-tab authentication. The login URL carries no draft. */
export function preserveLinkDraft(): boolean {
  const url = fragmentDestination()
  if (!url) return true
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ url, expiresAt: Date.now() + MAX_AGE_MS }))
    history.replaceState(history.state, '', location.pathname)
    return true
  } catch {
    return false
  }
}

export function consumeLinkDraft(): string {
  const direct = fragmentDestination()
  if (location.hash) history.replaceState(history.state, '', location.pathname)
  try {
    const saved = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    if (direct || !saved) return direct ?? ''
    const draft: unknown = JSON.parse(saved)
    if (
      isRecordLike(draft) &&
      typeof draft.expiresAt === 'number' &&
      draft.expiresAt > Date.now() &&
      typeof draft.url === 'string'
    )
      return simLinkDraftDestination(draft.url) ?? ''
  } catch {
    return direct ?? ''
  }
  return ''
}
