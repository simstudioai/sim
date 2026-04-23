import { type Span, trace } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  CopilotVfsOutcome,
  CopilotVfsReadOutcome,
  CopilotVfsReadPath,
} from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/copilot/generated/trace-events-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { markSpanForError } from '@/lib/copilot/request/otel'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'

// Lazy tracer (same pattern as lib/copilot/request/otel.ts).
function getVfsTracer() {
  return trace.getTracer('sim-copilot-vfs', '1.0.0')
}

function recordSpanError(span: Span, err: unknown) {
  markSpanForError(span, err)
}

const logger = createLogger('FileReader')

const MAX_TEXT_READ_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_IMAGE_READ_BYTES = 5 * 1024 * 1024 // 5 MB
// Parseable-document byte cap. Large office/PDF files can still
// produce huge extracted text; reject up front to avoid wasting a
// download + parse only to blow past the tool-result budget.
const MAX_PARSEABLE_READ_BYTES = 5 * 1024 * 1024 // 5 MB
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
  'application/json',
  'application/xml',
  'application/javascript',
])

const PARSEABLE_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'])

function isReadableType(contentType: string): boolean {
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
  buffer: Buffer,
  claimedType: string
): Promise<PreparedVisionImage | null> {
  return getVfsTracer().startActiveSpan(
    TraceSpan.CopilotVfsPrepareImage,
    {
      attributes: {
        [TraceAttr.CopilotVfsInputBytes]: buffer.length,
        [TraceAttr.CopilotVfsInputMediaTypeClaimed]: claimedType,
      },
    },
    async (span) => {
      try {
        const mediaType = detectImageMime(buffer, claimedType)
        span.setAttribute(TraceAttr.CopilotVfsInputMediaTypeDetected, mediaType)

        let sharpModule: typeof import('sharp')
        try {
          sharpModule = (await import('sharp')).default
        } catch (err) {
          logger.warn('Failed to load sharp for image preparation', {
            mediaType,
            error: toError(err).message,
          })
          span.setAttribute(TraceAttr.CopilotVfsSharpLoadFailed, true)
          const fitsWithoutSharp = buffer.length <= MAX_IMAGE_READ_BYTES
          span.setAttribute(
            TraceAttr.CopilotVfsOutcome,
            fitsWithoutSharp ? 'passthrough_no_sharp' : 'rejected_no_sharp'
          )
          return fitsWithoutSharp ? { buffer, mediaType, resized: false } : null
        }

        let metadata: Awaited<ReturnType<ReturnType<typeof sharpModule>['metadata']>>
        try {
          metadata = await sharpModule(buffer, { limitInputPixels: false }).metadata()
        } catch (err) {
          logger.warn('Failed to read image metadata for VFS read', {
            mediaType,
            error: toError(err).message,
          })
          span.setAttribute(TraceAttr.CopilotVfsMetadataFailed, true)
          const fitsWithoutSharp = buffer.length <= MAX_IMAGE_READ_BYTES
          span.setAttribute(
            TraceAttr.CopilotVfsOutcome,
            fitsWithoutSharp ? 'passthrough_no_metadata' : 'rejected_no_metadata'
          )
          return fitsWithoutSharp ? { buffer, mediaType, resized: false } : null
        }

        const width = metadata.width ?? 0
        const height = metadata.height ?? 0
        span.setAttributes({
          [TraceAttr.CopilotVfsInputWidth]: width,
          [TraceAttr.CopilotVfsInputHeight]: height,
        })

        const needsResize =
          buffer.length > MAX_IMAGE_READ_BYTES ||
          width > MAX_IMAGE_DIMENSION ||
          height > MAX_IMAGE_DIMENSION
        if (!needsResize) {
          span.setAttributes({
            [TraceAttr.CopilotVfsResized]: false,
            [TraceAttr.CopilotVfsOutcome]: CopilotVfsOutcome.PassthroughFitsBudget,
            [TraceAttr.CopilotVfsOutputBytes]: buffer.length,
            [TraceAttr.CopilotVfsOutputMediaType]: mediaType,
          })
          return { buffer, mediaType, resized: false }
        }

        const hasAlpha = Boolean(
          metadata.hasAlpha ||
            mediaType === 'image/png' ||
            mediaType === 'image/webp' ||
            mediaType === 'image/gif'
        )
        span.setAttribute(TraceAttr.CopilotVfsHasAlpha, hasAlpha)

        let attempts = 0
        for (const dimension of IMAGE_RESIZE_DIMENSIONS) {
          for (const quality of IMAGE_QUALITY_STEPS) {
            attempts += 1
            try {
              const pipeline = sharpModule(buffer, { limitInputPixels: false }).rotate().resize({
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
                  buffer: transformed.buffer,
                  mediaType: transformed.mediaType,
                  resized: true,
                }
              }
            } catch (err) {
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
            }
          }
        }

        span.setAttributes({
          [TraceAttr.CopilotVfsResized]: false,
          [TraceAttr.CopilotVfsResizeAttempts]: attempts,
          [TraceAttr.CopilotVfsOutcome]: CopilotVfsOutcome.RejectedTooLargeAfterResize,
        })
        return null
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
  return getVfsTracer().startActiveSpan(
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
        if (isImageFileType(record.type)) {
          span.setAttribute(TraceAttr.CopilotVfsReadPath, CopilotVfsReadPath.Image)
          const originalBuffer = await downloadWorkspaceFile(record)
          const prepared = await prepareImageForVision(originalBuffer, record.type)
          if (!prepared) {
            span.setAttribute(TraceAttr.CopilotVfsReadOutcome, CopilotVfsReadOutcome.ImageTooLarge)
            return {
              content: `[Image too large: ${record.name} (${(record.size / 1024 / 1024).toFixed(1)}MB, limit 5MB after resize/compression)]`,
              totalLines: 1,
            }
          }
          const sizeKb = (prepared.buffer.length / 1024).toFixed(1)
          const resizeNote = prepared.resized ? ', resized for vision' : ''
          span.setAttributes({
            [TraceAttr.CopilotVfsReadOutcome]: CopilotVfsReadOutcome.ImagePrepared,
            [TraceAttr.CopilotVfsReadOutputBytes]: prepared.buffer.length,
            [TraceAttr.CopilotVfsReadOutputMediaType]: prepared.mediaType,
            [TraceAttr.CopilotVfsReadImageResized]: prepared.resized,
          })
          return {
            content: `Image: ${record.name} (${sizeKb}KB, ${prepared.mediaType}${resizeNote})`,
            totalLines: 1,
            attachment: {
              type: 'image',
              source: {
                type: 'base64' as const,
                media_type: prepared.mediaType,
                data: prepared.buffer.toString('base64'),
              },
            },
          }
        }

        if (isReadableType(record.type)) {
          span.setAttribute(TraceAttr.CopilotVfsReadPath, CopilotVfsReadPath.Text)
          if (record.size > MAX_TEXT_READ_BYTES) {
            span.setAttribute(TraceAttr.CopilotVfsReadOutcome, CopilotVfsReadOutcome.TextTooLarge)
            return {
              content: `[File too large to display inline: ${record.name} (${record.size} bytes, limit ${MAX_TEXT_READ_BYTES})]`,
              totalLines: 1,
            }
          }

          const buffer = await downloadWorkspaceFile(record)
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
          const buffer = await downloadWorkspaceFile(record)
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
}
