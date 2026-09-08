import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'

function invalidSource(message: string): never {
  throw new PermanentDocumentProcessingError('invalid_file', message)
}

/**
 * Validates GIF blocks without decoding pixels or allocating image frames. An
 * animation cannot satisfy a one-image OCR response's completeness guarantee.
 */
function assertStaticGif(buffer: Buffer): void {
  if (
    buffer.length < 14 ||
    !['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
  ) {
    invalidSource('This file is not a valid GIF image. Re-export the image and retry.')
  }
  const invalidGif = () =>
    invalidSource('This GIF image is incomplete or invalid. Re-export the image and retry.')
  const requireBytes = (offset: number, count: number) => {
    if (offset + count > buffer.length) invalidGif()
  }
  const skipSubBlocks = (start: number): number => {
    let offset = start
    for (;;) {
      requireBytes(offset, 1)
      const size = buffer[offset++]
      if (size === 0) return offset
      requireBytes(offset, size)
      offset += size
    }
  }
  let offset = 13 + (buffer[10] & 128 ? 3 * 2 ** ((buffer[10] & 7) + 1) : 0)
  let frames = 0
  for (;;) {
    requireBytes(offset, 1)
    const marker = buffer[offset++]
    if (marker === 0x3b) {
      if (frames === 0) invalidGif()
      return
    }
    if (marker === 0x21) {
      requireBytes(offset, 1)
      offset = skipSubBlocks(offset + 1)
      continue
    }
    if (marker !== 0x2c) invalidGif()
    requireBytes(offset, 9)
    if (++frames > 1) {
      throw new PermanentDocumentProcessingError(
        'unsupported_file_type',
        'Animated GIFs cannot be indexed completely as a single image. Export the frames to a PDF or separate static images and retry.'
      )
    }
    const packed = buffer[offset + 8]
    offset += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0)
    requireBytes(offset, 1)
    offset = skipSubBlocks(offset + 1)
  }
}

/** Rejects proven input failures before they consume provider admission or paid OCR. */
export function assertOcrSourceSupported(buffer: Buffer, mimeType: string): void {
  if (mimeType === 'application/pdf' && !buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    invalidSource('This file is not a valid PDF. Re-export it as a PDF and retry.')
  }
  if (mimeType === 'image/gif') assertStaticGif(buffer)
}
