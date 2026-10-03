import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ChatBlobCopyTask } from '@/lib/mothership/chat/fork-chat-files'
import {
  inlineChatImageKey,
  inlineChatImageReferences,
} from '@/lib/mothership/chat/inline-image-key'
import { INLINE_CHAT_IMAGE_MAX_BYTES } from '@/lib/mothership/chat/inline-image-storage'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'

/** Only retained assistant image references are copied; their Markdown and request IDs stay unchanged. */
export function planForkInlineImages(
  messages: readonly PersistedMessage[],
  sourceChatId: string,
  newChatId: string
): ChatBlobCopyTask[] {
  const tasks = new Map<string, ChatBlobCopyTask>()
  for (const message of messages) {
    const published = inlineChatImageReferences(message)
    if (!published) continue
    for (const reference of published.references) {
      const sourceKey = inlineChatImageKey(sourceChatId, published.requestId, reference)
      tasks.set(sourceKey, {
        copyId: sourceKey,
        sourceKey,
        targetKey: inlineChatImageKey(newChatId, published.requestId, reference),
        context: 'mothership',
        fileName: 'chat-image.webp',
        contentType: 'image/webp',
        maxBytes: INLINE_CHAT_IMAGE_MAX_BYTES,
        persistMetadata: false,
      })
      if (tasks.size > 200)
        throw new OrchestrationError(
          'payload_too_large',
          'A chat fork can copy at most 200 inline images.'
        )
    }
  }
  return [...tasks.values()]
}
