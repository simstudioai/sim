import { SIM_LINK_DRAFT_PATH, simLinkDraftDestination } from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import {
  CAPTURE_INTENT_KEY,
  captureIntentKey,
  OPEN_SIM_COMMAND,
  REFERENCE_PAGE_KEY,
  SIM_ORIGIN,
} from '@/config'
import { captureIntentSchema } from '@/intent'
import { registerSimLinkOmnibox } from '@/omnibox'
import { registerShortHostVisits } from '@/short-hosts'
import { digestUrl } from '@/utils'

const logger = createLogger('BrowserExtension')
const SELECTION_MENU = 'ask-sim-selection'
const LINK_MENU = 'create-sim-link'

async function configure() {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: SELECTION_MENU,
    title: 'Ask Sim about selection',
    contexts: ['selection'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  })
  chrome.contextMenus.create({
    id: LINK_MENU,
    title: 'Create link in Sim',
    contexts: ['link'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
    targetUrlPatterns: ['http://*/*', 'https://*/*'],
  })
}

function open(tab: chrome.tabs.Tab, trigger: 'page' | 'selection' | 'keyboard') {
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
    func: (keyboard: boolean) => {
      if (!keyboard) return { href: location.href, selected: false }
      const active = document.activeElement
      const protectedFocus =
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.matches('iframe,frame,input,textarea,select') ||
          Boolean(chrome.dom.openOrClosedShadowRoot(active)?.activeElement))
      return {
        href: location.href,
        selected: protectedFocus || window.getSelection()?.isCollapsed === false,
      }
    },
    args: [trigger === 'keyboard'],
  })
  const referenceEnabled =
    trigger !== 'selection' &&
    chrome.storage.local
      .get(REFERENCE_PAGE_KEY)
      .then((values) => values[REFERENCE_PAGE_KEY] === true)
      .catch(() => false)
  void Promise.all([opened, identity, digestUrl(tab.url), referenceEnabled])
    .then(([, result, urlDigest, enabled]) => {
      const document = result[0]
      if (!document?.documentId || !document.result || document.result.href !== tab.url) return
      const kind = trigger === 'selection' || document.result.selected ? 'selection' : 'page'
      if (enabled && kind === 'page' && trigger !== 'keyboard') return
      return chrome.storage.session.set({
        [captureIntentKey(tab.windowId, generateId())]: {
          tabId: tab.id,
          windowId: tab.windowId,
          kind: enabled && kind === 'page' ? 'focus' : kind,
          focusComposer: trigger === 'keyboard',
          createdAt,
          documentId: document.documentId,
          urlDigest,
        },
      })
    })
    .catch(() => logger.warn('Could not attach this page; the side panel remains available'))
}

registerSimLinkOmnibox()
registerShortHostVisits()
chrome.runtime.onInstalled.addListener(() => {
  void configure().catch(() => logger.warn('Could not initialize extension controls'))
})
chrome.action.onClicked.addListener((tab) => open(tab, 'page'))
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.incognito || info.editable) return
  if (info.menuItemId === LINK_MENU && info.linkUrl) {
    const destination = simLinkDraftDestination(info.linkUrl)
    if (destination) {
      const draft = new URL(SIM_LINK_DRAFT_PATH, SIM_ORIGIN)
      draft.hash = new URLSearchParams({ url: destination }).toString()
      void chrome.tabs
        .create({ url: draft.href, windowId: tab.windowId })
        .catch(() => logger.warn('Could not open the Sim Link draft'))
    }
  }
  if (info.menuItemId === SELECTION_MENU) open(tab, 'selection')
})
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === OPEN_SIM_COMMAND && tab) open(tab, 'keyboard')
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
