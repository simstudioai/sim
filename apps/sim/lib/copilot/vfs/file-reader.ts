import { type Span, trace } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { SharpConstructor } from 'sharp'
import {
  CopilotVfsOutcome,
  CopilotVfsReadOutcome,
  CopilotVfsReadPath,
} from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/copilot/generated/trace-events-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { recordFileRead } from '@/lib/copilot/request/metrics'
import { markSpanForError } from '@/lib/copilot/request/otel'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { fetchWorkspaceFileBuffer } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { isHeifContainer, transcodeHeicToJpeg } from '@/lib/uploads/server/heic'
import {
  formatFileSize,
  isImageFileType,
  MODEL_SUPPORTED_IMAGE_MIME_TYPES,
  resolveEffectiveMimeType,
} from '@/lib/uploads/utils/file-utils'

// Lazy tracer (same pattern as lib/copilot/request/otel.ts).
function getVfsTracer() {
  return trace.getTracer('sim-copilot-vfs', '1.0.0')
}

function recordSpanError(span: Span, err: unknown) {
  markSpanForError(span, err)
}

const logger = createLogger('FileReader')

/** Inline text-read cap — exported so callers can align their own byte-sniff budgets with what read() can actually display. */
export const MAX_TEXT_READ_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_IMAGE_READ_BYTES = 5 * 1024 * 1024 // 5 MB
// Parseable-document byte cap. Large office/PDF files can still
// produce huge extracted text; reject up front to avoid wasting a
// download + parse only to blow past the tool-result budget.
const MAX_PARSEABLE_READ_BYTES = 5 * 1024 * 1024 // 5 MB
/** Source-image byte ceiling. Sits above the 20MB HEIC transcode ceiling, so a HEIF is bounded by the tighter of the two. */
const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024
/**
 * Pixel ceiling on the decoded raster. libvips materialises the whole raster, and
 * an allocation this large OOM-kills the process rather than throwing, so it has to
 * be refused up front. 100MP caps the decode near 400MB while clearing every real
 * camera — a 48MP iPhone still is 8064x6048.
 */
const MAX_IMAGE_INPUT_PIXELS = 100_000_000
const MAX_IMAGE_DIMENSION = 1568
const IMAGE_RESIZE_DIMENSIONS = [1568, 1280, 1024, 768]
const IMAGE_QUALITY_STEPS = [85, 70, 55, 40]

const TEXT_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'text/xml',
  'text/x-pptxgenjs',
  'text/x-docxjs',
  'text/x-python-pdf',
  'text/x-python-xlsx',
  'application/json',
  'application/xml',
  'application/javascript',
])

const PARSEABLE_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'])

export function isReadableFileType(contentType: string): boolean {
  return TEXT_TYPES.has(contentType) || contentType.startsWith('text/')
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

function detectImageMime(buf: Buffer, claimed: string): string {
  if (buf.length < 12) return claimed
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)
    return 'image/webp'
  return claimed
}

interface PreparedVisionImage {
  buffer: Buffer
  mediaType: string
  resized: boolean
}

/**
 * Shown to the model verbatim in the read placeholder, so each value names the one
 * thing that actually failed rather than a disjunction of everything that might have.
 */
const VisionImageRejection = {
  Undecodable: 'It could not be decoded.',
  TooManyPixels: 'It is too large to decode safely.',
  TooLargeAfterResize: 'It still exceeded the 5MB vision limit after resizing.',
} as const

type VisionImageResult =
  | { ok: true; image: PreparedVisionImage }
  | { ok: false; reason: (typeof VisionImageRejection)[keyof typeof VisionImageRejection] }

/**
 * Prepare an image for vision models: detect media type, optionally
 * resize/compress with sharp, and return the prepared buffer.
 *
 * Wrapped in a `copilot.vfs.prepare_image` span so the external trace
 * shows exactly when an image read blocked the request on CPU-heavy
 * encode attempts. Attributes record input dimensions, whether a resize
 * was needed, how many encode attempts it took, and the final
 * dimension/quality chosen.
 */
async function prepareImageForVision(
  sourceBuffer: Buffer,
  claimedType: string
): Promise<VisionImageResult> {
  return getVfsTracer().startActiveSpan(
    TraceSpan.CopilotVfsPrepareImage,
    {
      attributes: {
        [TraceAttr.CopilotVfsInputBytes]: sourceBuffer.length,
        [TraceAttr.CopilotVfsInputMediaTypeClaimed]: claimedType,
      },
    },
    async (span): Promise<VisionImageResult> => {
      try {
        const detectedType = detectImageMime(sourceBuffer, claimedType)
        span.setAttribute(TraceAttr.CopilotVfsInputMediaTypeDetected, detectedType)

        let sharpModule: SharpConstructor
        try {
          sharpModule = (await import('sharp')).default
        } catch (err) {
          logger.warn('Failed to load sharp for image preparation', {
            mediaType: detectedType,
            error: toError(err).message,
          })
          span.setAttribute(TraceAttr.CopilotVfsSharpLoadFailed, true)
          const fitsWithoutSharp =
            MODEL_SUPPORTED_IMAGE_MIME_TYPES.has(detectedType) &&
            sourceBuffer.length <= MAX_IMAGE_READ_BYTES
          span.setAttribute(
            TraceAttr.CopilotVfsOutcome,
            fitsWithoutSharp ? 'passthrough_no_sharp' : 'rejected_no_sharp'
          )
          if (!fitsWithoutSharp) return { ok: false, reason: VisionImageRejection.Undecodable }
          return {
            ok: true,
            image: { buffer: sourceBuffer, mediaType: detectedType, resized: false },
          }
        }

        // Left unguarded deliberately: metadata() only parses the header, so it
        // allocates nothing proportional to the declared dimensions, and enabling the
        // guard here would route an oversized image into the passthrough branch below
        // — which hands the bytes to the model instead of refusing them.
        const readMetadata = (candidate: Buffer) =>
          sharpModule(candidate, { limitInputPixels: false })
            .metadata()
            .catch((err: unknown) => {
              logger.warn('Failed to read image metadata for VFS read', {
                mediaType: detectedType,
                error: toError(err).message,
              })
              return null
            })

        // sharp first: its libvips reads everything we accept except HEVC-coded
        // HEIF, and it is ~10x faster than the WASM decoder. Capability-based
        // rather than brand-based, so AV1-coded `mif1` — which sharp handles
        // natively — does not get sent down the slow path.
        let buffer = sourceBuffer
        let mediaType = detectedType
        let metadata = await readMetadata(sourceBuffer)

        if (!metadata && isHeifContainer(sourceBuffer)) {
          const transcoded = await transcodeHeicToJpeg(sourceBuffer)
          if (transcoded) {
            buffer = transcoded
            mediaType = 'image/jpeg'
            metadata = await readMetadata(transcoded)
          }
        }

        if (!metadata) {
          span.setAttribute(TraceAttr.CopilotVfsMetadataFailed, true)
          // Bytes the model cannot decode are worse than no image: it describes
          // them as empty rather than reporting them as broken.
          const passthroughViable =
            MODEL_SUPPORTED_IMAGE_MIME_TYPES.has(mediaType) && buffer.length <= MAX_IMAGE_READ_BYTES
          span.setAttribute(
            TraceAttr.CopilotVfsOutcome,
            passthroughViable ? 'passthrough_no_metadata' : 'rejected_no_metadata'
          )
          if (!passthroughViable) return { ok: false, reason: VisionImageRejection.Undecodable }
          return { ok: true, image: { buffer, mediaType, resized: false } }
        }

        const width = metadata.width ?? 0
        const height = metadata.height ?? 0
        span.setAttributes({
          [TraceAttr.CopilotVfsInputWidth]: width,
          [TraceAttr.CopilotVfsInputHeight]: height,
        })

        const pixels = width * height
        if (pixels > MAX_IMAGE_INPUT_PIXELS) {
          logger.warn('Rejected image above the decode pixel budget', {
            mediaType,
            width,
            height,
            pixels,
            budget: MAX_IMAGE_INPUT_PIXELS,
            bytes: buffer.length,
          })
          span.setAttribute(TraceAttr.CopilotVfsOutcome, 'rejected_pixel_budget')
          return { ok: false, reason: VisionImageRejection.TooManyPixels }
        }

        // A format the model cannot decode has to be re-encoded even when it is
        // already small enough — the ladder below emits JPEG or WebP, both of
        // which it accepts.
        const needsReencode =
          !MODEL_SUPPORTED_IMAGE_MIME_TYPES.has(mediaType) ||
          buffer.length > MAX_IMAGE_READ_BYTES ||
          width > MAX_IMAGE_DIMENSION ||
          height > MAX_IMAGE_DIMENSION
        if (!needsReencode) {
          span.setAttributes({
            [TraceAttr.CopilotVfsResized]: false,
            [TraceAttr.CopilotVfsOutcome]: CopilotVfsOutcome.PassthroughFitsBudget,
            [TraceAttr.CopilotVfsOutputBytes]: buffer.length,
            [TraceAttr.CopilotVfsOutputMediaType]: mediaType,
          })
          return { ok: true, image: { buffer, mediaType, resized: false } }
        }

        const hasAlpha = Boolean(
          metadata.hasAlpha ||
            mediaType === 'image/png' ||
            mediaType === 'image/webp' ||
            mediaType === 'image/gif'
        )
        span.setAttribute(TraceAttr.CopilotVfsHasAlpha, hasAlpha)

        let attempts = 0
        let decodeFailed = false
        for (const dimension of IMAGE_RESIZE_DIMENSIONS) {
          for (const quality of IMAGE_QUALITY_STEPS) {
            attempts += 1
            try {
              const pipeline = sharpModule(buffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
                .rotate()
                .resize({
                  width: dimension,
                  height: dimension,
                  fit: 'inside',
                  withoutEnlargement: true,
                })

              const transformed = hasAlpha
                ? {
                    buffer: await pipeline
                      .webp({ quality, alphaQuality: quality, effort: 4 })
                      .toBuffer(),
                    mediaType: 'image/webp',
                  }
                : {
                    buffer: await pipeline
                      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
                      .toBuffer(),
                    mediaType: 'image/jpeg',
                  }

              span.addEvent(TraceEvent.CopilotVfsResizeAttempt, {
                [TraceAttr.CopilotVfsResizeDimension]: dimension,
                [TraceAttr.CopilotVfsResizeQuality]: quality,
                [TraceAttr.CopilotVfsResizeOutputBytes]: transformed.buffer.length,
                [TraceAttr.CopilotVfsResizeFitsBudget]:
                  transformed.buffer.length <= MAX_IMAGE_READ_BYTES,
              })

              if (transformed.buffer.length <= MAX_IMAGE_READ_BYTES) {
                logger.info('Resized image for VFS read', {
                  originalBytes: buffer.length,
                  outputBytes: transformed.buffer.length,
                  originalWidth: width || undefined,
                  originalHeight: height || undefined,
                  maxDimension: dimension,
                  quality,
                  originalMediaType: mediaType,
                  outputMediaType: transformed.mediaType,
                })
                span.setAttributes({
                  [TraceAttr.CopilotVfsResized]: true,
                  [TraceAttr.CopilotVfsResizeAttempts]: attempts,
                  [TraceAttr.CopilotVfsResizeChosenDimension]: dimension,
                  [TraceAttr.CopilotVfsResizeChosenQuality]: quality,
                  [TraceAttr.CopilotVfsOutputBytes]: transformed.buffer.length,
                  [TraceAttr.CopilotVfsOutputMediaType]: transformed.mediaType,
                  [TraceAttr.CopilotVfsOutcome]: CopilotVfsOutcome.Resized,
                })
                return {
                  ok: true,
                  image: {
                    buffer: transformed.buffer,
                    mediaType: transformed.mediaType,
                    resized: true,
                  },
                }
              }
            } catch (err) {
              // Move to the next dimension rather than the next quality: the quality
              // rungs re-decode the identical source and only change the encoder, so
              // repeating a failed decode there is pure waste. A smaller dimension is
              // worth trying — libvips shrinks JPEG on load, so it decodes less.
              decodeFailed = true
              logger.warn('Failed image resize attempt for VFS read', {
                mediaType,
                dimension,
                quality,
                error: toError(err).message,
              })
              span.addEvent(TraceEvent.CopilotVfsResizeAttemptFailed, {
                [TraceAttr.CopilotVfsResizeDimension]: dimension,
                [TraceAttr.CopilotVfsResizeQuality]: quality,
                [TraceAttr.ErrorMessage]: toError(err).message.slice(0, 500),
              })
              break
            }
          }
        }

        span.setAttributes({
          [TraceAttr.CopilotVfsResized]: false,
          [TraceAttr.CopilotVfsResizeAttempts]: attempts,
          [TraceAttr.CopilotVfsOutcome]: CopilotVfsOutcome.RejectedTooLargeAfterResize,
        })
        return {
          ok: false,
          reason: decodeFailed
            ? VisionImageRejection.Undecodable
            : VisionImageRejection.TooLargeAfterResize,
        }
      } catch (err) {
        recordSpanError(span, err)
        throw err
      } finally {
        span.end()
      }
    }
  )
}

export interface FileReadResult {
  content: string
  totalLines: number
  attachment?: {
    type: string
    name?: string
    source: {
      type: 'base64'
      media_type: string
      data: string
    }
  }
}

/**
 * Read and return the content of a workspace file record.
 * Handles images (base64 attachment), parseable documents (PDF, DOCX, etc.),
 * binary files, and plain text with size guards.
 *
 * Wrapped in `copilot.vfs.read_file` so the parent mothership trace shows
 * per-file read latency, the path taken (image / text / parseable /
 * binary), and any size rejection. The `prepareImageForVision` span
 * nests underneath for the image-resize path.
 */
export async function readFileRecord(record: WorkspaceFileRecord): Promise<FileReadResult | null> {
  const startedAt = Date.now()
  const result = await getVfsTracer().startActiveSpan(
    TraceSpan.CopilotVfsReadFile,
    {
      attributes: {
        [TraceAttr.CopilotVfsFileName]: record.name,
        [TraceAttr.CopilotVfsFileMediaType]: record.type,
        [TraceAttr.CopilotVfsFileSizeBytes]: record.size,
        [TraceAttr.CopilotVfsFileExtension]: getExtension(record.name),
      },
    },
    async (span) => {
      try {
        // Resolve against the filename: a phone upload commonly stores as
        // `application/octet-stream`, and matching the raw type would route a real
        // image down the binary path where the model never sees it.
        if (isImageFileType(resolveEffectiveMimeType(record.type, record.name))) {
          span.setAttribute(TraceAttr.CopilotVfsReadPath, CopilotVfsReadPath.Image)
          // `record.size` is client-declared, so it only buys the friendly placeholder;
          // the download's own `maxBytes` is what actually bounds the bytes read.
          if (record.size > MAX_IMAGE_SOURCE_BYTES) {
            span.setAttribute(TraceAttr.CopilotVfsReadOutcome, CopilotVfsReadOutcome.ImageTooLarge)
            return {
              content: `[Image too large to read inline: ${record.name} (${record.size} bytes, limit ${MAX_IMAGE_SOURCE_BYTES})]`,
              totalLines: 1,
            }
          }
          const originalBuffer = await fetchWorkspaceFileBuffer(record, {
            maxBytes: MAX_IMAGE_SOURCE_BYTES,
          })
          const prepared = await prepareImageForVision(originalBuffer, record.type)
          if (!prepared.ok) {
            span.setAttribute(TraceAttr.CopilotVfsReadOutcome, CopilotVfsReadOutcome.ImageTooLarge)
            return {
              content: `[Image unavailable: ${record.name} (${formatFileSize(record.size)}). ${prepared.reason}]`,
              totalLines: 1,
            }
          }
          const { buffer, mediaType, resized } = prepared.image
          const sizeKb = (buffer.length / 1024).toFixed(1)
          const resizeNote = resized ? ', resized for vision' : ''
          span.setAttributes({
            [TraceAttr.CopilotVfsReadOutcome]: CopilotVfsReadOutcome.ImagePrepared,
            [TraceAttr.CopilotVfsReadOutputBytes]: buffer.length,
            [TraceAttr.CopilotVfsReadOutputMediaType]: mediaType,
            [TraceAttr.CopilotVfsReadImageResized]: resized,
          })
          return {
            content: `Image: ${record.name} (${sizeKb}KB, ${mediaType}${resizeNote})`,
            totalLines: 1,
            attachment: {
              type: 'image',
              name: record.name,
              source: {
                type: 'base64' as const,
                media_type: mediaType,
                data: buffer.toString('base64'),
              },
            },
          }
        }

        if (isReadableFileType(record.type)) {
          span.setAttribute(TraceAttr.CopilotVfsReadPath, CopilotVfsReadPath.Text)
          if (record.size > MAX_TEXT_READ_BYTES) {
            span.setAttribute(TraceAttr.CopilotVfsReadOutcome, CopilotVfsReadOutcome.TextTooLarge)
            return {
              content: `[File too large to display inline: ${record.name} (${record.size} bytes, limit ${MAX_TEXT_READ_BYTES})]`,
              totalLines: 1,
            }
          }

          const buffer = await fetchWorkspaceFileBuffer(record, { maxBytes: MAX_TEXT_READ_BYTES })
          const content = buffer.toString('utf-8')
          const lines = content.split('\n').length
          span.setAttributes({
            [TraceAttr.CopilotVfsReadOutcome]: CopilotVfsReadOutcome.TextRead,
            [TraceAttr.CopilotVfsReadOutputBytes]: buffer.length,
            [TraceAttr.CopilotVfsReadOutputLines]: lines,
          })
          return { content, totalLines: lines }
        }

        const ext = getExtension(record.name)
        if (PARSEABLE_EXTENSIONS.has(ext)) {
          span.setAttribute(TraceAttr.CopilotVfsReadPath, CopilotVfsReadPath.ParseableDocument)
          if (record.size > MAX_PARSEABLE_READ_BYTES) {
            span.setAttribute(
              TraceAttr.CopilotVfsReadOutcome,
              CopilotVfsReadOutcome.DocumentTooLarge
            )
            return {
              content: `[Document too large to parse inline: ${record.name} (${record.size} bytes, limit ${MAX_PARSEABLE_READ_BYTES})]`,
              totalLines: 1,
            }
          }
          const buffer = await fetchWorkspaceFileBuffer(record, {
            maxBytes: MAX_PARSEABLE_READ_BYTES,
          })
          try {
            const { parseBuffer } = await import('@/lib/file-parsers')
            const result = await parseBuffer(buffer, ext)
            const content = result.content || ''
            const lines = content.split('\n').length
            span.setAttributes({
              [TraceAttr.CopilotVfsReadOutcome]: CopilotVfsReadOutcome.DocumentParsed,
              [TraceAttr.CopilotVfsReadOutputBytes]: content.length,
              [TraceAttr.CopilotVfsReadOutputLines]: lines,
            })
            return { content, totalLines: lines }
          } catch (parseErr) {
            logger.warn('Failed to parse document', {
              fileName: record.name,
              ext,
              error: toError(parseErr).message,
            })
            span.addEvent(TraceEvent.CopilotVfsParseFailed, {
              [TraceAttr.ErrorMessage]: toError(parseErr).message.slice(0, 500),
            })
            span.setAttribute(TraceAttr.CopilotVfsReadOutcome, CopilotVfsReadOutcome.ParseFailed)
            return {
              content: `[Could not parse ${record.name} (${record.type}, ${record.size} bytes)]`,
              totalLines: 1,
            }
          }
        }

        span.setAttributes({
          [TraceAttr.CopilotVfsReadPath]: CopilotVfsReadPath.Binary,
          [TraceAttr.CopilotVfsReadOutcome]: CopilotVfsReadOutcome.BinaryPlaceholder,
        })
        return {
          content: `[Binary file: ${record.name} (${record.type}, ${record.size} bytes). Cannot display as text.]`,
          totalLines: 1,
        }
      } catch (err) {
        logger.warn('Failed to read workspace file', {
          fileName: record.name,
          error: toError(err).message,
        })
        recordSpanError(span, err)
        span.setAttribute(TraceAttr.CopilotVfsReadOutcome, CopilotVfsReadOutcome.ReadFailed)
        return null
      } finally {
        span.end()
      }
    }
  )
  // Durable read duration + size by coarse outcome (the fine-grained outcome —
  // ImageTooLarge / ParseFailed / etc. — stays on the Tempo span). readFileRecord
  // returns null on failure rather than throwing.
  recordFileRead(result ? 'success' : 'read_failed', Date.now() - startedAt, record.size ?? 0)
  return result
}
