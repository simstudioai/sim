import {
  PAGE_SNAPSHOT_MAX_BYTES,
  PAGE_SNAPSHOT_MAX_TEXT_LENGTH,
  pageSnapshotSchema,
} from '@sim/browser-extension-protocol'
import { generateId } from '@sim/utils/id'
import { SIM_ORIGIN } from '@/config'
import { extractPageText } from '@/extract'
import { digestUrl } from '@/utils'

/** Captures only the focused tab and rejects navigation or tab changes during extraction. */
export async function captureActivePage(
  kind: 'page' | 'selection',
  expected?: { tabId: number; documentId: string; urlDigest: string }
) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined || !tab.url || (expected !== undefined && expected.tabId !== tab.id)) {
    throw new Error('Activate the page and click the Sim toolbar icon to allow access.')
  }
  const url = new URL(tab.url)
  if (expected && (await digestUrl(tab.url)) !== expected.urlDigest) {
    throw new Error('The page changed before reading. Attach it again.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin === SIM_ORIGIN ||
    url.username ||
    url.password ||
    tab.incognito
  ) {
    throw new Error('Choose a regular web page outside Sim to attach.')
  }
  const results = await chrome.scripting.executeScript({
    target: expected
      ? { tabId: tab.id, documentIds: [expected.documentId] }
      : { tabId: tab.id, frameIds: [0] },
    world: 'ISOLATED',
    func: extractPageText,
    args: [kind, PAGE_SNAPSHOT_MAX_TEXT_LENGTH, PAGE_SNAPSHOT_MAX_BYTES],
  })
  const result = results[0]
  if (!result?.documentId || !result.result) throw new Error('This page could not be read.')
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (current?.id !== tab.id || current.url !== tab.url || current.status === 'loading') {
    throw new Error('The page changed while reading. Attach it again.')
  }
  const identity = await chrome.scripting.executeScript({
    target: { tabId: tab.id, documentIds: [result.documentId] },
    func: () => location.href,
    world: 'ISOLATED',
  })
  if (identity[0]?.documentId !== result.documentId || identity[0]?.result !== tab.url) {
    throw new Error('The page changed while reading. Attach it again.')
  }
  return pageSnapshotSchema.parse({ ...result.result, id: generateId() })
}
