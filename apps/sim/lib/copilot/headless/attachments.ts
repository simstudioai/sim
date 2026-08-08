import { imageSize } from 'image-size'
import { isCanonicalBase64 } from '@/lib/api/contracts/primitives'
import {
  MAX_V2_CHAT_ATTACHMENT_BYTES,
  MAX_V2_CHAT_ATTACHMENTS_TOTAL_BYTES,
  MAX_V2_CHAT_IMAGE_DIMENSION,
  MAX_V2_CHAT_IMAGE_PIXELS,
  MAX_V2_CHAT_IMAGES_TOTAL_PIXELS,
  MAX_V2_CHAT_TEXT_ATTACHMENT_BYTES,
  V2_CHAT_DOCUMENT_MEDIA_TYPES,
  V2_CHAT_IMAGE_MEDIA_TYPES,
  V2_CHAT_TEXT_MEDIA_TYPES,
  type V2ChatAttachment,
} from '@/lib/api/contracts/v2/chat'
import { sniffImageContentType } from '@/lib/uploads/utils/validation'

export interface MothershipInlineFileAttachment {
  type: 'image' | 'document'
  filename: string
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

type AttachmentValidationErrorCode = 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE'

export type PreparedV2ChatAttachments =
  | { success: true; attachments: MothershipInlineFileAttachment[] }
  | {
      success: false
      error: { code: AttachmentValidationErrorCode; message: string }
    }

type AttachmentValidationFailure = Extract<PreparedV2ChatAttachments, { success: false }>

const IMAGE_MEDIA_TYPES = new Set<string>(V2_CHAT_IMAGE_MEDIA_TYPES)
const DOCUMENT_MEDIA_TYPES = new Set<string>(V2_CHAT_DOCUMENT_MEDIA_TYPES)
const TEXT_MEDIA_TYPES = new Set<string>(V2_CHAT_TEXT_MEDIA_TYPES)
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function decodeCanonicalBase64(data: string): Buffer | null {
  return data.length > 0 && isCanonicalBase64(data) ? Buffer.from(data, 'base64') : null
}

function isPdf(buffer: Buffer): boolean {
  // Match the existing workspace VFS behavior: PDFs may have a BOM or leading
  // whitespace, but the signature must appear near the beginning.
  return buffer.subarray(0, 1024).toString('latin1').includes('%PDF')
}

function invalidAttachment(message: string): AttachmentValidationFailure {
  return { success: false, error: { code: 'BAD_REQUEST', message } }
}

function unsupportedAttachment(message: string): AttachmentValidationFailure {
  return { success: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message } }
}

function oversizedAttachment(message: string): AttachmentValidationFailure {
  return { success: false, error: { code: 'PAYLOAD_TOO_LARGE', message } }
}

function validateImageDimensions(
  name: string,
  buffer: Buffer
): { success: true; pixels: number } | AttachmentValidationFailure {
  let dimensions: ReturnType<typeof imageSize>
  try {
    dimensions = imageSize(buffer)
  } catch {
    return unsupportedAttachment(`Attachment "${name}" is not a readable image`)
  }

  const { width, height } = dimensions
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return unsupportedAttachment(`Attachment "${name}" has invalid image dimensions`)
  }

  if (
    width > MAX_V2_CHAT_IMAGE_DIMENSION ||
    height > MAX_V2_CHAT_IMAGE_DIMENSION ||
    width > MAX_V2_CHAT_IMAGE_PIXELS / height
  ) {
    return oversizedAttachment(
      `Attachment "${name}" dimensions ${width}x${height} exceed the ${MAX_V2_CHAT_IMAGE_DIMENSION}-pixel axis or ${MAX_V2_CHAT_IMAGE_PIXELS}-pixel image limit`
    )
  }

  return { success: true, pixels: width * height }
}

/**
 * Validates the public inline-file boundary and maps it to Mothership's
 * existing base64 attachment contract. No path or URL is accepted or resolved.
 */
export function prepareV2ChatAttachments(
  input: V2ChatAttachment[] | undefined
): PreparedV2ChatAttachments {
  if (!input?.length) return { success: true, attachments: [] }

  const prepared: MothershipInlineFileAttachment[] = []
  let totalBytes = 0
  let totalImagePixels = 0

  for (const attachment of input) {
    const isImage = IMAGE_MEDIA_TYPES.has(attachment.mediaType)
    const isPdfDocument = DOCUMENT_MEDIA_TYPES.has(attachment.mediaType)
    const isTextDocument = TEXT_MEDIA_TYPES.has(attachment.mediaType)

    if (!isImage && !isPdfDocument && !isTextDocument) {
      return unsupportedAttachment(
        `Attachment "${attachment.name}" has unsupported media type ${attachment.mediaType}`
      )
    }

    const decoded = decodeCanonicalBase64(attachment.data)
    if (!decoded) {
      return invalidAttachment(`Attachment "${attachment.name}" data must be canonical base64`)
    }

    const perFileLimit = isTextDocument
      ? MAX_V2_CHAT_TEXT_ATTACHMENT_BYTES
      : MAX_V2_CHAT_ATTACHMENT_BYTES
    if (decoded.byteLength > perFileLimit) {
      return oversizedAttachment(
        `Attachment "${attachment.name}" exceeds the ${perFileLimit}-byte limit for ${attachment.mediaType}`
      )
    }

    totalBytes += decoded.byteLength
    if (totalBytes > MAX_V2_CHAT_ATTACHMENTS_TOTAL_BYTES) {
      return oversizedAttachment(
        `Attachments exceed the ${MAX_V2_CHAT_ATTACHMENTS_TOTAL_BYTES}-byte aggregate limit`
      )
    }

    if (isImage) {
      const sniffedMediaType = sniffImageContentType(decoded)
      if (sniffedMediaType !== attachment.mediaType) {
        return unsupportedAttachment(
          `Attachment "${attachment.name}" bytes do not match ${attachment.mediaType}`
        )
      }
      const dimensions = validateImageDimensions(attachment.name, decoded)
      if (!dimensions.success) return dimensions
      totalImagePixels += dimensions.pixels
      if (totalImagePixels > MAX_V2_CHAT_IMAGES_TOTAL_PIXELS) {
        return oversizedAttachment(
          `Images exceed the ${MAX_V2_CHAT_IMAGES_TOTAL_PIXELS}-pixel aggregate limit`
        )
      }
    } else if (isPdfDocument) {
      if (!isPdf(decoded)) {
        return unsupportedAttachment(`Attachment "${attachment.name}" is not a valid PDF`)
      }
    } else {
      try {
        const text = utf8Decoder.decode(decoded)
        if (text.includes('\0')) {
          return unsupportedAttachment(`Attachment "${attachment.name}" is not UTF-8 text`)
        }
      } catch {
        return unsupportedAttachment(`Attachment "${attachment.name}" is not UTF-8 text`)
      }
    }

    prepared.push({
      type: isImage ? 'image' : 'document',
      filename: attachment.name,
      source: {
        type: 'base64',
        media_type: attachment.mediaType,
        data: attachment.data,
      },
    })
  }

  return { success: true, attachments: prepared }
}
