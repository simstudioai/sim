import {
  SIM_LINK_HOSTS,
  SIM_LINK_SUGGESTIONS_PATH,
  simLinkSuggestionsSchema,
} from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { SIM_ORIGIN, VISIT_SHORT_HOSTS_MESSAGE } from '@/config'

const logger = createLogger('ShortHosts')
const VISITED_AT_KEY = 'shortHostsVisitedAt'
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const VISIT_TIMEOUT_MS = 15_000

/** False when signed out or links are off here, where `go/x` should stay an ordinary search. */
async function linksAreEnabled(): Promise<boolean> {
  const response = await fetch(`${SIM_ORIGIN}${SIM_LINK_SUGGESTIONS_PATH}`, {
    credentials: 'include',
  })
  if (!response.ok) return false
  return simLinkSuggestionsSchema.parse(await response.json()).enabled === true
}

/**
 * Closes once Chrome has committed the visit, which is what records the host in its history.
 * False when it never got that far, such as the person closing the tab first.
 */
async function visitInBackground(host: string): Promise<boolean> {
  const { id: tabId } = await chrome.tabs.create({ url: `http://${host}/`, active: false })
  if (tabId === undefined) return false
  const visited = await new Promise<boolean>((resolve) => {
    const finish = (committed: boolean) => {
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(updated)
      resolve(committed)
    }
    const updated = (id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && (change.status === 'complete' || tab.url?.startsWith(SIM_ORIGIN))) {
        finish(true)
      }
    }
    const timeout = setTimeout(() => finish(false), VISIT_TIMEOUT_MS)
    chrome.tabs.onUpdated.addListener(updated)
  })
  await chrome.tabs.remove(tabId).catch(() => undefined)
  return visited
}

/**
 * Chrome searches for `go/handbook` until its history holds `go` as a typed host, and it counts a
 * visit to an unfamiliar single-label host as typed. So a background visit teaches the address bar
 * without asking anything of the user. History expires after 90 days and can be cleared, which is
 * why this repeats: a later visit only adds a history entry while the host is known, and relearns
 * it once it isn't.
 */
async function visitShortHosts() {
  const stored = await chrome.storage.local.get(VISITED_AT_KEY)
  const visitedAt = stored[VISITED_AT_KEY]
  if (typeof visitedAt === 'number' && Date.now() - visitedAt < REFRESH_INTERVAL_MS) return
  if (!(await linksAreEnabled())) return
  const visits = await Promise.all(SIM_LINK_HOSTS.map(visitInBackground))
  if (visits.every(Boolean)) await chrome.storage.local.set({ [VISITED_AT_KEY]: Date.now() })
}

export function registerShortHostVisits() {
  let visiting = false
  const visit = () => {
    if (visiting) return
    visiting = true
    void visitShortHosts()
      .catch(() => logger.warn('Could not visit the short link hosts'))
      .finally(() => {
        visiting = false
      })
  }
  chrome.runtime.onInstalled.addListener(visit)
  chrome.runtime.onStartup.addListener(visit)
  // Installing signed out leaves nothing to learn yet, so signing in to the panel is the next chance.
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id === chrome.runtime.id && message === VISIT_SHORT_HOSTS_MESSAGE) visit()
  })
}
