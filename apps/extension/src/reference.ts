import {
  type ExtensionToAppMessage,
  PAGE_REFERENCE_TIMEOUT_MS,
} from '@sim/browser-extension-protocol'
import { LRUCache } from 'lru-cache'
import {
  captureActivePage,
  captureErrorMessage,
  PageCaptureError,
  SiteAccessRequiredError,
} from '@/capture'
import { REFERENCE_PAGE_KEY } from '@/config'

export const PAGE_ATTACHMENT_PENDING_MESSAGE = 'Wait for the page attachment, then try again.'

interface ReferenceOptions {
  session: () => string | null
  post: (message: ExtensionToAppMessage) => void
  manualCaptureError: () => { message: string; reason?: 'selection' } | undefined
  showStatus: (message: string | SiteAccessRequiredError) => void
  clearAccessStatus: () => void
}

/** Correlates an explicit Send with a single active-page read in the current conversation. */
export function createReferenceCapture({
  session,
  post,
  manualCaptureError,
  showStatus,
  clearAccessStatus,
}: ReferenceOptions) {
  const envelope = { channel: 'sim-extension', version: 1 } as const
  const requests = new LRUCache<string, true>({ max: 64, ttl: PAGE_REFERENCE_TIMEOUT_MS })
  let pending: { sessionId: string; requestId: string; controller: AbortController } | null = null
  let enabled = false
  let revision = 0
  let preferenceWrite: Promise<void> | null = null

  function replyError(
    sessionId: string,
    requestId: string,
    error: string | SiteAccessRequiredError,
    reason?: 'selection'
  ) {
    if (session() !== sessionId) return
    const message = typeof error === 'string' ? error : error.message
    if (typeof error !== 'string' || reason) showStatus(error)
    post({
      ...envelope,
      type: 'send-context-error',
      sessionId,
      requestId,
      message,
      ...(typeof error !== 'string' ? { reason: 'site-access' as const } : reason && { reason }),
    })
  }

  function cancel(message?: string) {
    if (!pending) return
    pending.controller.abort()
    if (message) replyError(pending.sessionId, pending.requestId, message)
    pending = null
  }

  function publishPreference(next: boolean) {
    enabled = next
    if (!next) cancel('Reference current page was turned off. Send again to continue.')
    const sessionId = session()
    if (sessionId) post({ ...envelope, type: 'reference-preference', sessionId, enabled })
  }

  async function refreshPreference(sessionId = session()): Promise<boolean> {
    while (sessionId && session() === sessionId) {
      const current = revision
      await preferenceWrite
      try {
        const values = await chrome.storage.local.get(REFERENCE_PAGE_KEY)
        if (session() !== sessionId) return false
        if (current !== revision || preferenceWrite) continue
        publishPreference(values[REFERENCE_PAGE_KEY] === true)
        return true
      } catch {
        if (session() !== sessionId) return false
        if (current !== revision || preferenceWrite) continue
        publishPreference(false)
        showStatus(
          'Page reference is unavailable. Attach the page manually or reopen Sim to try again.'
        )
        return true
      }
    }
    return false
  }

  async function setPreference(next: boolean) {
    if (!navigator.userActivation.isActive) {
      publishPreference(enabled)
      return
    }
    // A disable takes effect before the storage change event, including for a read in progress.
    revision++
    if (!next) {
      clearAccessStatus()
      publishPreference(false)
    }
    const write = chrome.storage.local.set({ [REFERENCE_PAGE_KEY]: next }).catch(() => {
      showStatus('Could not save the page reference setting.')
    })
    preferenceWrite = write
    await write
    if (preferenceWrite === write) {
      preferenceWrite = null
      await refreshPreference()
    }
  }

  async function capture(sessionId: string, requestId: string) {
    if (requests.has(requestId)) return
    requests.set(requestId, true)
    if (!navigator.userActivation.isActive || !enabled) {
      replyError(sessionId, requestId, 'Send again with Reference current page enabled.')
      return
    }
    const manualError = manualCaptureError()
    if (pending || manualError) {
      replyError(
        sessionId,
        requestId,
        manualError?.message ?? PAGE_ATTACHMENT_PENDING_MESSAGE,
        manualError?.reason
      )
      return
    }
    const request = { sessionId, requestId, controller: new AbortController() }
    pending = request
    const started = performance.now()
    const expired = 'The page reference expired. Send again to continue.'
    const timeout = window.setTimeout(() => {
      if (pending === request) cancel(expired)
    }, PAGE_REFERENCE_TIMEOUT_MS)
    const assertCurrent = () => {
      if (
        pending !== request ||
        session() !== sessionId ||
        !enabled ||
        performance.now() - started >= PAGE_REFERENCE_TIMEOUT_MS
      )
        throw new PageCaptureError(expired)
    }
    try {
      const snapshot = await captureActivePage('page', undefined, request.controller.signal)
      assertCurrent()
      clearAccessStatus()
      post({ ...envelope, type: 'send-context', sessionId, requestId, snapshot })
    } catch (error) {
      if (pending !== request || session() !== sessionId) return
      replyError(
        sessionId,
        requestId,
        error instanceof SiteAccessRequiredError ? error : captureErrorMessage(error)
      )
    } finally {
      window.clearTimeout(timeout)
      if (pending === request) pending = null
    }
  }

  return {
    capture,
    refreshPreference,
    setPreference,
    busy: () => pending !== null,
    manualRequested: () => cancel('Wait for the page attachment, then send again.'),
    preferenceChanged(value: unknown) {
      if (preferenceWrite) return
      revision++
      publishPreference(value === true)
    },
    reset() {
      revision++
      cancel()
      requests.clear()
    },
  }
}
