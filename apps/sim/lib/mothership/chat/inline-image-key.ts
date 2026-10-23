import { createHash } from 'node:crypto'
import {
  INLINE_CHAT_IMAGE_PREFIX,
  inlineImageRequestIdSchema,
  inlineImageSourceSchema,
  normalizeInlineFileReference,
} from '@/lib/mothership/chat/inline-image-reference'
import { collectMarkdownImageSources } from '@/lib/mothership/chat/markdown-images'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'

/** Stable per-message source identity makes replay independent of sandbox lifetime. */
export function inlineChatImageKey(chatId: string, requestId: string, reference: string): string {
  inlineImageRequestIdSchema.parse(chatId)
  inlineImageRequestIdSchema.parse(requestId)
  const digest = createHash('sha256').update(normalizeInlineFileReference(reference)).digest('hex')
  return `${INLINE_CHAT_IMAGE_PREFIX}${chatId}/${requestId}/${digest}.webp`
}

/**
 * The inline image references an assistant message published under its request id: every
 * first-party Markdown image source in its text and text blocks. Anything else (user text,
 * a message with no request receipt, remote URLs) never had a chat image stored.
 */
export function inlineChatImageReferences(
  message: Pick<PersistedMessage, 'role' | 'requestId' | 'content' | 'contentBlocks'>
): { requestId: string; references: string[] } | null {
  if (
    message.role !== 'assistant' ||
    !message.requestId ||
    !inlineImageRequestIdSchema.safeParse(message.requestId).success
  )
    return null
  const contents = [
    message.content,
    ...(message.contentBlocks ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.content ?? ''),
  ]
  const references = new Set<string>()
  for (const content of contents) {
    // Every Markdown image, inline or reference-style, opens with `![`; most messages have none.
    if (typeof content !== 'string' || !content.includes('![')) continue
    for (const reference of collectMarkdownImageSources(content))
      if (inlineImageSourceSchema.safeParse(reference).success) references.add(reference)
  }
  return { requestId: message.requestId, references: [...references] }
}
