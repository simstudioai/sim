import {
  PAGE_SNAPSHOT_MAX_BYTES,
  PAGE_SNAPSHOT_MAX_TEXT_LENGTH,
  pageSnapshotSchema,
} from '@sim/browser-extension-protocol'
import { generateId } from '@sim/utils/id'
import { PAGE_ACCESS_ORIGINS, SIM_ORIGIN } from '@/config'
import { extractPageText } from '@/extract'
import { digestUrl } from '@/utils'

/** A public capture error whose message is safe to share with the hosted composer. */
export class PageCaptureError extends Error {}

/** Chrome scripting failures may contain the full private URL of the tab. */
export function captureErrorMessage(error: unknown): string {
  return error instanceof PageCaptureError
    ? error.message
    : 'This page could not be read. Check site access and try again.'
}

/** Only emitted after verifying the selected document is still active. */
export class UnreadableSelectionError extends PageCaptureError {
  constructor(
    message: string,
    readonly tabId: number,
    readonly windowId: number
  ) {
    super(message)
  }
}

export class SiteAccessRequiredError extends PageCaptureError {
  constructor(
    readonly tabId: number,
    readonly windowId: number
  ) {
    super('Enable page access once to use pages across websites. ')
  }
}

/** Captures only the focused tab and rejects navigation or tab changes during extraction. */
export async function captureActivePage(
  kind: 'page' | 'selection',
  expected?: { tabId: number; documentId: string; urlDigest: string },
  signal?: AbortSignal
) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  signal?.throwIfAborted()
  if (tab?.id === undefined || tab.incognito)
    throw new PageCaptureError('This page cannot be attached.')
  if (expected && expected.tabId !== tab.id) {
    throw new PageCaptureError('The page changed before reading. Attach it again.')
  }
  if (!tab.url) {
    const allowed = await chrome.permissions.contains({ origins: PAGE_ACCESS_ORIGINS })
    signal?.throwIfAborted()
    if (allowed) throw new PageCaptureError('This page cannot be attached.')
    throw new SiteAccessRequiredError(tab.id, tab.windowId)
  }
  let changed = false
  const activated = (active: chrome.tabs.OnActivatedInfo) => {
    if (active.windowId === tab.windowId && active.tabId !== tab.id) changed = true
  }
  const updated = (tabId: number, change: chrome.tabs.OnUpdatedInfo) => {
    if (tabId === tab.id && (change.status === 'loading' || change.url !== undefined))
      changed = true
  }
  chrome.tabs.onActivated.addListener(activated)
  chrome.tabs.onUpdated.addListener(updated)
  const removeListeners = () => {
    chrome.tabs.onActivated.removeListener(activated)
    chrome.tabs.onUpdated.removeListener(updated)
    signal?.removeEventListener('abort', removeListeners)
  }
  signal?.addEventListener('abort', removeListeners, { once: true })
  try {
    const snapshot = await readTab({ tabId: tab.id, url: tab.url }, kind, expected, signal)
    if (changed) throw new PageCaptureError('The page changed while reading. Attach it again.')
    return snapshot
  } catch (error) {
    if (changed) throw new PageCaptureError('The page changed while reading. Attach it again.')
    if (expected && !(error instanceof PageCaptureError))
      throw new PageCaptureError(
        'The original document cannot be read. Attach the current page again.'
      )
    throw error
  } finally {
    removeListeners()
  }
}

async function readTab(
  tab: { tabId: number; url: string },
  kind: 'page' | 'selection',
  expected?: { documentId: string; urlDigest: string },
  signal?: AbortSignal
) {
  const url = new URL(tab.url)
  if (expected && (await digestUrl(tab.url)) !== expected.urlDigest) {
    throw new PageCaptureError('The page changed before reading. Attach it again.')
  }
  let pathname = url.pathname
  if (url.origin === SIM_ORIGIN) {
    try {
      pathname = decodeURIComponent(pathname)
    } catch {
      throw new PageCaptureError('This page cannot be attached.')
    }
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (url.origin === SIM_ORIGIN &&
      (pathname === '/extension' || pathname.startsWith('/extension/'))) ||
    url.username ||
    url.password
  ) {
    throw new PageCaptureError('This page cannot be attached.')
  }
  const results = await chrome.scripting.executeScript({
    target: expected
      ? { tabId: tab.tabId, documentIds: [expected.documentId] }
      : { tabId: tab.tabId, frameIds: [0] },
    world: 'ISOLATED',
    func: extractPageText,
    args: [kind, PAGE_SNAPSHOT_MAX_TEXT_LENGTH, PAGE_SNAPSHOT_MAX_BYTES],
  })
  const result = results[0]
  signal?.throwIfAborted()
  if (!result?.documentId || !result.result)
    throw new PageCaptureError('This page could not be read.')
  const identity = await chrome.scripting.executeScript({
    target: { tabId: tab.tabId, documentIds: [result.documentId] },
    func: () => location.href,
    world: 'ISOLATED',
  })
  if (identity[0]?.documentId !== result.documentId || identity[0]?.result !== tab.url) {
    throw new PageCaptureError('The page changed while reading. Attach it again.')
  }
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true })
  signal?.throwIfAborted()
  if (current?.id !== tab.tabId || current.url !== tab.url || current.status === 'loading') {
    throw new PageCaptureError('The page changed while reading. Attach it again.')
  }
  if (result.result.error) {
    if (kind === 'selection')
      throw new UnreadableSelectionError(result.result.error, current.id, current.windowId)
    throw new PageCaptureError(result.result.error)
  }
  return pageSnapshotSchema.parse({ ...result.result, id: generateId() })
}
