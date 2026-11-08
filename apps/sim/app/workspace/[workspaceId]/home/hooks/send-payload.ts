import type { SendPayload } from '@/lib/mothership/chat/types'

/** The payload of a send, without fields it does not set. */
export function sendPayload(source: SendPayload): SendPayload {
  return {
    content: source.content,
    ...(source.fileAttachments ? { fileAttachments: source.fileAttachments } : {}),
    ...(source.contexts ? { contexts: source.contexts } : {}),
    ...(source.requestMode ? { requestMode: source.requestMode } : {}),
    ...(source.assistantSearch ? { assistantSearch: source.assistantSearch } : {}),
    ...(source.assistantSearchLevel !== undefined
      ? { assistantSearchLevel: source.assistantSearchLevel }
      : {}),
  }
}
