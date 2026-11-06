import type { PageSnapshot } from '@sim/browser-extension-protocol'
import { utf8ByteLength } from '@sim/utils/paste'
import { MAX_CHAT_CONTEXTS } from '@/lib/mothership/chat/context-limits'

const MAX_PAGE_CONTEXT_TEXT_LENGTH = 150_000
const MAX_PAGE_CONTEXT_BYTES = 450_000

/** Bounds the combined page budget and refuses ambiguous snapshot identities within a turn. */
export function getPageContextBudgetError(
  contexts: readonly { kind: string; snapshot?: PageSnapshot }[]
): string | undefined {
  if (contexts.length > MAX_CHAT_CONTEXTS) return 'Too many attachments'
  let textLength = 0
  let bytes = 0
  const ids = new Set<string>()
  for (const context of contexts) {
    if (context.kind !== 'browser_page') continue
    if (!context.snapshot) return 'A page snapshot is required'
    if (ids.has(context.snapshot.id)) return 'Page snapshot IDs must be unique within a message'
    ids.add(context.snapshot.id)
    textLength += context.snapshot.text.length
    bytes += utf8ByteLength(JSON.stringify(context.snapshot))
    if (textLength > MAX_PAGE_CONTEXT_TEXT_LENGTH || bytes > MAX_PAGE_CONTEXT_BYTES)
      return 'These pages contain too much text'
  }
}
