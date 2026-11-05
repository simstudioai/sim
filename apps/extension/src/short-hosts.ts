import { SIM_LINK_HOSTS } from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { SIM_ORIGIN } from '@/config'

const logger = createLogger('ShortHosts')
const LEARNED_KEY = 'shortHostsLearned'
const VISIT_TIMEOUT_MS = 15_000

/** Closes once Chrome has committed the visit, which is what records the host in its history. */
async function visitInBackground(host: string) {
  const { id: tabId } = await chrome.tabs.create({ url: `http://${host}/`, active: false })
  if (tabId === undefined) return
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(updated)
      resolve()
    }
    const updated = (id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && (change.status === 'complete' || tab.url?.startsWith(SIM_ORIGIN))) {
        finish()
      }
    }
    const timeout = setTimeout(finish, VISIT_TIMEOUT_MS)
    chrome.tabs.onUpdated.addListener(updated)
  })
  await chrome.tabs.remove(tabId).catch(() => undefined)
}

/**
 * Chrome searches for `go/handbook` until it has seen `go` as a host, so visiting each short host
 * once is what makes them work from the address bar. A visit to an unfamiliar single-label host
 * counts as typed in Chrome's history, so it teaches the address bar without asking the user to.
 */
async function learnShortHosts() {
  const stored = await chrome.storage.local.get(LEARNED_KEY)
  if (stored[LEARNED_KEY] === true) return
  await Promise.all(SIM_LINK_HOSTS.map(visitInBackground))
  await chrome.storage.local.set({ [LEARNED_KEY]: true })
}

export function registerShortHostLearning() {
  const learn = () => {
    void learnShortHosts().catch(() => logger.warn('Could not visit the short link hosts'))
  }
  chrome.runtime.onInstalled.addListener(learn)
  // A managed install can run before any window exists, so it retries at the next browser start.
  chrome.runtime.onStartup.addListener(learn)
}
