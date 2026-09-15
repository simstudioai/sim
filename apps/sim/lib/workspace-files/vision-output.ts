import sharp from 'sharp'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const MAX_VISION_OUTPUT_BYTES = 5 * 1024 * 1024
export const MAX_VISION_GRID_DIMENSION = 2200

/** Validate a sandbox's exported image before decoding its bounded base64 payload. */
export async function readSandboxJpeg(encoded: string | undefined): Promise<Buffer> {
  if (!encoded || encoded.length > 4 * Math.ceil(MAX_VISION_OUTPUT_BYTES / 3)) {
    throw new OrchestrationError('payload_too_large', 'Rendered image is missing or exceeds 5 MB')
  }
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new OrchestrationError('validation', 'Document renderer returned an invalid image')
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length > MAX_VISION_OUTPUT_BYTES || buffer.toString('base64') !== encoded) {
    throw new OrchestrationError('validation', 'Document renderer returned an invalid image')
  }
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_VISION_GRID_DIMENSION ** 2 })
    const metadata = await image.metadata()
    if (
      metadata.format !== 'jpeg' ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_VISION_GRID_DIMENSION ||
      metadata.height > MAX_VISION_GRID_DIMENSION
    ) {
      throw new Error('Invalid rendered dimensions or format')
    }
    await image.stats()
  } catch {
    throw new OrchestrationError('validation', 'Document renderer returned an invalid image')
  }
  return buffer
}
