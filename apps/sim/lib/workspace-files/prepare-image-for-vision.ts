import sharp from 'sharp'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox } from '@/lib/execution/remote-sandbox'
import {
  isHeifContainer,
  isHevcHeifContainer,
  transcodeHeicToJpeg,
} from '@/lib/uploads/server/heic'
import { MAX_WORKSPACE_FORMDATA_FILE_SIZE } from '@/lib/uploads/shared/types'
import { MAX_VISION_OUTPUT_BYTES, readSandboxJpeg } from '@/lib/workspace-files/vision-output'

const MAX_INPUT_PIXELS = 268_402_689
const MAX_DIMENSION = 1568
const PROVIDER_FORMATS = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} as const

interface VisionImage {
  buffer: Buffer
  mediaType: (typeof PROVIDER_FORMATS)[keyof typeof PROVIDER_FORMATS]
  width: number
  height: number
}

/** Formats absent from Sharp use bounded Pillow decoding in the existing document sandbox. */
async function convertWithPillow(
  buffer: Buffer,
  format: 'BMP' | 'ICO',
  signal?: AbortSignal
): Promise<Buffer> {
  const inputPath = `/home/user/input.${format.toLowerCase()}`
  const result = await executeInSandbox({
    language: CodeLanguage.Python,
    sandboxKind: 'doc',
    timeoutMs: 60_000,
    signal,
    sandboxFiles: [{ path: inputPath, content: buffer.toString('base64'), encoding: 'base64' }],
    outputSandboxPath: '/home/user/image.jpg',
    code: `import warnings, os
from PIL import Image
warnings.simplefilter("error", Image.DecompressionBombWarning)
Image.MAX_IMAGE_PIXELS = 100_000_000
with Image.open(${JSON.stringify(inputPath)}) as image:
    if image.format != ${JSON.stringify(format)} or image.width * image.height > Image.MAX_IMAGE_PIXELS:
        raise ValueError("Invalid or oversized image")
    image.thumbnail((1568, 1568))
    rgba = image.convert("RGBA")
    canvas = Image.new("RGB", image.size, "white")
    canvas.paste(rgba, mask=rgba.getchannel("A"))
    canvas.save("/home/user/image.jpg", "JPEG", quality=85)
if os.path.getsize("/home/user/image.jpg") > ${MAX_VISION_OUTPUT_BYTES}:
    raise ValueError("Rendered image exceeds 5 MB")`,
  })
  signal?.throwIfAborted()
  if (result.error)
    throw new OrchestrationError('validation', `${format} image could not be decoded`)
  return readSandboxJpeg(result.exportedFileContent)
}

/** Convert already-authorized image bytes into a bounded provider-supported image. */
export async function prepareImageForVision(
  source: Buffer,
  signal?: AbortSignal
): Promise<VisionImage> {
  signal?.throwIfAborted()
  if (!source.length) throw new OrchestrationError('validation', 'Image is empty')
  if (source.length > MAX_WORKSPACE_FORMDATA_FILE_SIZE) {
    throw new OrchestrationError('payload_too_large', 'Image exceeds the 100 MB read limit')
  }
  let buffer = source
  if (isHevcHeifContainer(source)) {
    const converted = await transcodeHeicToJpeg(source)
    signal?.throwIfAborted()
    if (!converted)
      throw new OrchestrationError(
        'validation',
        'HEIC image could not be decoded within the image limits'
      )
    buffer = converted
  }
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') {
    buffer = await convertWithPillow(buffer, 'BMP', signal)
  } else if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x00010000) {
    buffer = await convertWithPillow(buffer, 'ICO', signal)
  }
  let metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => null)
  if (!metadata && isHeifContainer(buffer)) {
    const converted = await transcodeHeicToJpeg(buffer)
    if (converted) {
      buffer = converted
      metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .metadata()
        .catch(() => null)
    }
  }
  signal?.throwIfAborted()
  const width = metadata?.width ?? 0
  const height = metadata?.pageHeight ?? metadata?.height ?? 0
  const pages = metadata?.pages ?? 1
  if (!metadata || !width || !height) {
    throw new OrchestrationError(
      'validation',
      'Image cannot be decoded within the image pixel limit'
    )
  }
  if (width * height * pages > MAX_INPUT_PIXELS) {
    throw new OrchestrationError('payload_too_large', 'Image exceeds the decoded pixel limit')
  }
  const mediaType =
    metadata.format === 'png' ||
    metadata.format === 'jpeg' ||
    metadata.format === 'webp' ||
    metadata.format === 'gif'
      ? PROVIDER_FORMATS[metadata.format]
      : undefined
  try {
    if (
      mediaType &&
      buffer.length <= MAX_VISION_OUTPUT_BYTES &&
      width <= MAX_DIMENSION &&
      height <= MAX_DIMENSION
    ) {
      await sharp(buffer, { animated: true, limitInputPixels: MAX_INPUT_PIXELS }).stats()
      signal?.throwIfAborted()
      return { buffer, mediaType, width, height }
    }
    for (const dimension of [MAX_DIMENSION, 1024, 768]) {
      signal?.throwIfAborted()
      const pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize({
        width: dimension,
        height: dimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      const output = await (metadata.hasAlpha
        ? pipeline.webp({ quality: 80 })
        : pipeline.jpeg({ quality: 80 })
      ).toBuffer({ resolveWithObject: true })
      if (output.data.length <= MAX_VISION_OUTPUT_BYTES) {
        signal?.throwIfAborted()
        return {
          buffer: output.data,
          mediaType: metadata.hasAlpha ? 'image/webp' : 'image/jpeg',
          width: output.info.width,
          height: output.info.height,
        }
      }
    }
  } catch {
    signal?.throwIfAborted()
    throw new OrchestrationError('validation', 'Image could not be decoded')
  }
  throw new OrchestrationError(
    'payload_too_large',
    'Image could not be reduced to the 5 MB vision limit'
  )
}
