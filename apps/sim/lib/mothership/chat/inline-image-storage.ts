import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  INLINE_CHAT_IMAGE_PREFIX,
  inlineImageRequestIdSchema,
  normalizeInlineFileReference,
} from '@/lib/mothership/chat/inline-image-reference'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'

export const INLINE_CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Revalidate published bytes and strip active content/metadata before durable display. */
export async function normalizeInlineChatImage(
  source: Buffer,
  signal?: AbortSignal
): Promise<Buffer> {
  signal?.throwIfAborted()
  if (!source.length || source.length > INLINE_CHAT_IMAGE_MAX_BYTES)
    throw new OrchestrationError(
      'payload_too_large',
      'An inline image must be between 1 byte and 5 MiB.'
    )
  try {
    const image = sharp(source, { limitInputPixels: 25_000_000, pages: 1 })
    const metadata = await image.metadata()
    if (!metadata.format || !['png', 'jpeg', 'webp', 'gif'].includes(metadata.format))
      throw new OrchestrationError(
        'validation',
        'Inline display requires a decoded PNG, JPEG, WebP, or GIF image.'
      )
    const buffer = await image
      .rotate()
      .resize(2200, 2200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()
    signal?.throwIfAborted()
    if (buffer.length > INLINE_CHAT_IMAGE_MAX_BYTES)
      throw new OrchestrationError('payload_too_large', 'The inline image exceeds 5 MiB.')
    return buffer
  } catch (cause) {
    signal?.throwIfAborted()
    if (cause instanceof OrchestrationError) throw cause
    const error = new OrchestrationError('validation', 'The inline image could not be decoded.')
    error.cause = cause
    throw error
  }
}

/** The chat application boundary authorizes before this storage primitive is called. */
export async function storeInlineChatImage(
  chatId: string,
  requestId: string,
  reference: string,
  buffer: Buffer,
  signal?: AbortSignal
) {
  try {
    await uploadFile({
      file: buffer,
      fileName: 'chat-image.webp',
      contentType: 'image/webp',
      context: 'mothership',
      customKey: inlineChatImageKey(chatId, requestId, reference),
      preserveKey: true,
      persistMetadata: false,
      createOnly: true,
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    /** A concurrent immutable publication may already own this key. Never overwrite it. */
    const conflict =
      typeof error === 'object' &&
      error !== null &&
      (('code' in error &&
        ['EEXIST', 'PreconditionFailed', 'ConditionNotMet', 'BlobAlreadyExists', 412].includes(
          error.code as string | number
        )) ||
        ('statusCode' in error && error.statusCode === 412) ||
        ('$metadata' in error &&
          typeof error.$metadata === 'object' &&
          error.$metadata !== null &&
          'httpStatusCode' in error.$metadata &&
          error.$metadata.httpStatusCode === 412) ||
        ('name' in error && error.name === 'PreconditionFailed'))
    if (!conflict) throw error
    await loadInlineChatImage(chatId, requestId, reference, signal)
  }
}

export async function loadInlineChatImage(
  chatId: string,
  requestId: string,
  reference: string,
  signal?: AbortSignal
): Promise<Buffer> {
  try {
    return await downloadFile({
      key: inlineChatImageKey(chatId, requestId, reference),
      context: 'mothership',
      maxBytes: INLINE_CHAT_IMAGE_MAX_BYTES,
      signal,
    })
  } catch (error) {
    if (
      isObjectNotFoundError(error) ||
      (error instanceof Error && 'code' in error && error.code === 'ENOENT')
    )
      throw new OrchestrationError('not_found', 'Image not found')
    throw error
  }
}

/** Stable per-message source identity makes replay independent of sandbox lifetime. */
export function inlineChatImageKey(chatId: string, requestId: string, reference: string): string {
  inlineImageRequestIdSchema.parse(chatId)
  inlineImageRequestIdSchema.parse(requestId)
  const digest = createHash('sha256').update(normalizeInlineFileReference(reference)).digest('hex')
  return `${INLINE_CHAT_IMAGE_PREFIX}${chatId}/${requestId}/${digest}.webp`
}
