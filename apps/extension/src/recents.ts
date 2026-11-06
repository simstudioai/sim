import {
  RECENT_PAGE_ICON_MAX_LENGTH,
  type RecentPage,
  type RecentsRequest,
  type RecentsStatus,
  recentsRequestSchema,
  selectRecentPages,
} from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { RECENT_PAGES_ENABLED_KEY, SIM_ORIGIN } from '@/config'

const logger = createLogger('RecentPages')
const HISTORY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
/** Enough that filtering a busy day's private and sign-in pages still fills the row. */
const HISTORY_SEARCH_LIMIT = 500

async function readStatus(): Promise<RecentsStatus> {
  const [granted, values] = await Promise.all([
    chrome.permissions.contains({ permissions: ['history'] }),
    chrome.storage.local.get(RECENT_PAGES_ENABLED_KEY),
  ])
  return {
    permission: granted ? 'granted' : 'not_granted',
    enabled: values[RECENT_PAGES_ENABLED_KEY] === true,
  }
}

/** The worker reads its own `_favicon`, so a page never needs web-accessible access to it. */
async function readIcon(pageUrl: string): Promise<string | undefined> {
  const address = new URL(chrome.runtime.getURL('/_favicon/'))
  address.searchParams.set('pageUrl', pageUrl)
  address.searchParams.set('size', '32')
  const response = await fetch(address)
  if (!response.ok) return undefined
  const bytes = new Uint8Array(await response.arrayBuffer())
  // Chrome serves these as PNG without a content type.
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47)
    return undefined
  const icon = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
  return icon.length <= RECENT_PAGE_ICON_MAX_LENGTH ? icon : undefined
}

async function readRecentPages(limit: number): Promise<RecentPage[]> {
  const { permission, enabled } = await readStatus()
  if (permission !== 'granted' || !enabled) return []
  const visits = await chrome.history.search({
    text: '',
    startTime: Date.now() - HISTORY_WINDOW_MS,
    maxResults: HISTORY_SEARCH_LIMIT,
  })
  const pages = selectRecentPages(visits, SIM_ORIGIN, limit)
  if (!(await chrome.permissions.contains({ permissions: ['favicon'] }))) return pages
  return Promise.all(
    pages.map(async (page) => {
      const iconUrl = await readIcon(page.url).catch(() => undefined)
      return iconUrl ? { ...page, iconUrl } : page
    })
  )
}

async function answer(request: RecentsRequest) {
  if (request.type === 'recents-status') return readStatus()
  if (request.type === 'recent-pages') return { pages: await readRecentPages(request.limit) }
  await chrome.tabs.create({ url: chrome.runtime.getURL('recents.html') })
  return { opened: true }
}

/**
 * The only route to browsing history. `externally_connectable` admits the Sim origin alone, and
 * the sender is checked again so a manifest change cannot widen who can read it. Pages are answered
 * and forgotten: nothing here stores an address.
 */
export function registerRecentPages() {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (sender.origin !== SIM_ORIGIN) return false
    const request = recentsRequestSchema.safeParse(message)
    if (!request.success) return false
    void answer(request.data).then(sendResponse, () => {
      logger.warn('Could not answer a recents request')
      sendResponse(undefined)
    })
    return true
  })
  // Removing the permission is a decision to stop. Chrome can re-add it without asking later, so
  // that must not silently turn the row back on.
  chrome.permissions.onRemoved.addListener(({ permissions }) => {
    if (!permissions?.includes('history')) return
    void chrome.storage.local
      .remove(RECENT_PAGES_ENABLED_KEY)
      .catch(() => logger.warn('Could not clear the recents preference'))
  })
}
