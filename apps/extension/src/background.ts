import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { CAPTURE_INTENT_KEY, captureIntentKey } from '@/config'
import { captureIntentSchema } from '@/intent'
import { digestUrl } from '@/utils'

const logger = createLogger('BrowserExtension')
const SELECTION_MENU = 'ask-sim-selection'

async function configure() {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: SELECTION_MENU,
    title: 'Ask Sim about selection',
    contexts: ['selection'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  })
}

function open(tab: chrome.tabs.Tab, kind: 'page' | 'selection') {
  if (tab.incognito) return
  // Chrome requires open() in the original user-gesture task, before any await.
  const opened = chrome.sidePanel.open({ windowId: tab.windowId })
  if (tab.id === undefined || !tab.url) {
    void opened.catch(() => logger.warn('Could not open the side panel'))
    return
  }
  const createdAt = Date.now()
  const identity = chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [0] },
    world: 'ISOLATED',
    func: () => location.href,
  })
  void Promise.all([opened, identity, digestUrl(tab.url)])
    .then(([, result, urlDigest]) => {
      const document = result[0]
      if (!document?.documentId || document.result !== tab.url) return
      return chrome.storage.session.set({
        [captureIntentKey(tab.windowId, generateId())]: {
          tabId: tab.id,
          windowId: tab.windowId,
          kind,
          createdAt,
          documentId: document.documentId,
          urlDigest,
        },
      })
    })
    .catch(() => logger.warn('Could not attach this page; the side panel remains available'))
}

chrome.runtime.onInstalled.addListener(() => {
  void configure().catch(() => logger.warn('Could not initialize extension controls'))
})
chrome.action.onClicked.addListener((tab) => open(tab, 'page'))
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === SELECTION_MENU && tab && !info.editable) open(tab, 'selection')
})
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-sim' && tab) open(tab, 'page')
})
function clearTabIntent(tabId: number) {
  void chrome.storage.session
    .get(null)
    .then((state) => {
      const keys = Object.keys(state).filter((key) => {
        if (!key.startsWith(`${CAPTURE_INTENT_KEY}:`)) return false
        const intent = captureIntentSchema.safeParse(state[key])
        return intent.success && intent.data.tabId === tabId
      })
      if (keys.length) return chrome.storage.session.remove(keys)
    })
    .catch(() => logger.warn('Could not clear the capture intent'))
}
chrome.tabs.onRemoved.addListener(clearTabIntent)
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || change.url) clearTabIntent(tabId)
})
chrome.windows.onRemoved.addListener((windowId) => {
  void chrome.storage.session
    .get(null)
    .then((state) => {
      const keys = Object.keys(state).filter((key) =>
        key.startsWith(`${CAPTURE_INTENT_KEY}:${windowId}:`)
      )
      if (keys.length) return chrome.storage.session.remove(keys)
    })
    .catch(() => logger.warn('Could not clear the capture intent'))
})
