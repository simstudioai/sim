import { isRecordLike } from '@sim/utils/object'
import { decodeDataUriWithinLimit } from '@/lib/file-parsers/data-uri'
import { isFileParserError } from '@/lib/file-parsers/errors'
import type { InternalToolFile } from '@/lib/internal/tool-operations/file-result'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file'
import { resolveStoredFileMetadata } from '@/lib/uploads/utils/stored-file-metadata'
import { MAX_OCR_EXTRACTED_IMAGES } from '@/tools/mistral/types'

/** Largest single image kept; a bigger one is a page scan, not a figure. */
const MAX_OCR_IMAGE_BYTES = 20 * 1024 * 1024

interface OcrImageFiles {
  /** The OCR output with every `image_base64` removed and each kept image named. */
  output: Record<string, unknown>
  files: InternalToolFile[]
}

/** The decoded image, or null when it is over the per-image cap. */
function decodeImage(imageBase64: string): { buffer: Buffer; mediaType: string | null } | null {
  const dataUri = imageBase64.startsWith('data:') ? imageBase64 : `data:;base64,${imageBase64}`
  try {
    return decodeDataUriWithinLimit(dataUri, MAX_OCR_IMAGE_BYTES)
  } catch (error) {
    if (isFileParserError(error) && error.code === 'complexity_limit') return null
    throw error
  }
}

/**
 * Turns the base64 images in a Mistral OCR response into files the executor
 * stores, so image bytes never travel through block outputs. Each kept image
 * gets a `file_name` matching its stored file; an image past the count, the
 * per-image cap, or the total byte budget keeps its bounding box but no file.
 */
export function extractOcrImageFiles(output: unknown): OcrImageFiles {
  if (!isRecordLike(output)) return { output: {}, files: [] }
  if (!Array.isArray(output.pages)) return { output, files: [] }
  const files: InternalToolFile[] = []
  let totalBytes = 0
  const pages = output.pages.map((page: unknown) => {
    if (!isRecordLike(page) || !Array.isArray(page.images)) return page
    const pageIndex = typeof page.index === 'number' ? page.index : 0
    const images = page.images.map((image: unknown) => {
      if (!isRecordLike(image)) return image
      const { image_base64: imageBase64, ...rest } = image
      if (typeof imageBase64 !== 'string' || !imageBase64) return rest
      if (files.length >= MAX_OCR_EXTRACTED_IMAGES) return rest
      const decoded = decodeImage(imageBase64)
      if (!decoded || totalBytes + decoded.buffer.length > MAX_BUFFERED_TRANSFER_BYTES) return rest
      totalBytes += decoded.buffer.length
      const id = typeof image.id === 'string' && image.id ? image.id : `img-${files.length}.jpeg`
      /** Storage renames an image from its bytes; naming it the same way keeps `file_name` matching. */
      const draftName = `page-${pageIndex}-${id}`
      const { fileName, mimeType } = resolveStoredFileMetadata(
        draftName,
        resolveEffectiveMimeType(decoded.mediaType, draftName),
        decoded.buffer
      )
      files.push({ buffer: decoded.buffer, name: fileName, mimeType })
      return { ...rest, file_name: fileName }
    })
    return { ...page, images }
  })
  return { output: { ...output, pages }, files }
}
