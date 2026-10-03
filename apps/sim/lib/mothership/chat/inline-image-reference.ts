import { z } from 'zod'
import { workspaceFileIdSchema } from '@/lib/api/contracts/primitives'

export const INLINE_CHAT_IMAGE_PREFIX = 'chat-images/'
export const inlineImageRequestIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)

/** These are first-party file namespaces, not arbitrary URLs or host filesystem paths. */
export function isInlineFileReference(reference: string): boolean {
  if (!reference || reference.length > 2048 || /[\u0000-\u001f\u007f]/.test(reference)) return false
  try {
    encodeURI(reference)
  } catch {
    return false
  }
  return (
    reference.startsWith('files/') ||
    reference.startsWith('uploads/') ||
    reference.startsWith('/tmp/') ||
    reference.startsWith('/home/user/') ||
    (reference.startsWith('wf_') && workspaceFileIdSchema.safeParse(reference).success) ||
    z.string().uuid().safeParse(reference).success
  )
}
export const inlineImageSourceSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value) && isInlineFileReference(value),
    'Use a files/, uploads/, /tmp/, or /home/user/ image reference.'
  )

/** Source text stays unchanged; the renderer resolves it to an already-published private snapshot. */
export function inlineChatImageUrl(chatId: string, requestId: string, reference: string): string {
  return `/api/mothership/chats/${encodeURIComponent(chatId)}/images/${encodeURIComponent(requestId)}?path=${encodeURIComponent(normalizeInlineFileReference(reference))}`
}

/** Match CommonMark's URI encoding without decoding a literal percent sign twice. */
export function normalizeInlineFileReference(reference: string): string {
  inlineImageSourceSchema.parse(reference)
  return encodeURI(reference).replace(
    /%25([0-9a-f]{2})/gi,
    (_match, hex: string) => `%${hex.toUpperCase()}`
  )
}
