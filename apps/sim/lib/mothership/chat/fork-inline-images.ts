import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ChatBlobCopyTask } from '@/lib/mothership/chat/fork-chat-files'
import {
  inlineImageRequestIdSchema,
  inlineImageSourceSchema,
} from '@/lib/mothership/chat/inline-image-reference'
import {
  INLINE_CHAT_IMAGE_MAX_BYTES,
  inlineChatImageKey,
} from '@/lib/mothership/chat/inline-image-storage'
import { collectMarkdownImageSources } from '@/lib/mothership/chat/markdown-images'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'

/** Only retained assistant image references are copied; their Markdown and request IDs stay unchanged. */
export function planForkInlineImages(
  messages: readonly PersistedMessage[],
  sourceChatId: string,
  newChatId: string
): ChatBlobCopyTask[] {
  const tasks = new Map<string, ChatBlobCopyTask>()
  for (const message of messages) {
    if (
      message.role !== 'assistant' ||
      !message.requestId ||
      !inlineImageRequestIdSchema.safeParse(message.requestId).success
    )
      continue
    const contents = [
      message.content,
      ...(message.contentBlocks ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.content ?? ''),
    ]
    for (const content of contents) {
      for (const reference of collectMarkdownImageSources(content)) {
        if (!inlineImageSourceSchema.safeParse(reference).success) continue
        const sourceKey = inlineChatImageKey(sourceChatId, message.requestId, reference)
        tasks.set(sourceKey, {
          copyId: sourceKey,
          sourceKey,
          targetKey: inlineChatImageKey(newChatId, message.requestId, reference),
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
  }
  return [...tasks.values()]
}
