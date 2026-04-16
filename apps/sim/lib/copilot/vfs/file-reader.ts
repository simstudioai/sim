import { SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'

/**
 * Lazy tracer (see lib/copilot/request/otel.ts for the same pattern and
 * why we resolve on every call).
 */
function getVfsTracer() {
  return trace.getTracer('sim-copilot-vfs', '1.0.0')
}

function recordSpanError(span: Span, err: unknown) {
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  })
  span.recordException(err instanceof Error ? err : new Error(String(err)))
}

const logger = createLogger('FileReader')

const MAX_TEXT_READ_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_IMAGE_READ_BYTES = 5 * 1024 * 1024 // 5 MB
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
				'copilot.vfs.input.bytes': buffer.length,
				'copilot.vfs.input.media_type_claimed': claimedType,
			},
		},
		async (span) => {
			try {
				const mediaType = detectImageMime(buffer, claimedType)
				span.setAttribute('copilot.vfs.input.media_type_detected', mediaType)

				let sharpModule: typeof import('sharp').default
				try {
					sharpModule = (await import('sharp')).default
				} catch (err) {
					logger.warn('Failed to load sharp for image preparation', {
						mediaType,
						error: err instanceof Error ? err.message : String(err),
					})
					span.setAttribute('copilot.vfs.sharp.load_failed', true)
					const fitsWithoutSharp = buffer.length <= MAX_IMAGE_READ_BYTES
					span.setAttribute(
						'copilot.vfs.outcome',
						fitsWithoutSharp ? 'passthrough_no_sharp' : 'rejected_no_sharp',
					)
					return fitsWithoutSharp ? { buffer, mediaType, resized: false } : null
				}

				let metadata: Awaited<ReturnType<ReturnType<typeof sharpModule>['metadata']>>
				try {
					metadata = await sharpModule(buffer, { limitInputPixels: false }).metadata()
				} catch (err) {
					logger.warn('Failed to read image metadata for VFS read', {
						mediaType,
						error: err instanceof Error ? err.message : String(err),
					})
					span.setAttribute('copilot.vfs.metadata.failed', true)
					const fitsWithoutSharp = buffer.length <= MAX_IMAGE_READ_BYTES
					span.setAttribute(
						'copilot.vfs.outcome',
						fitsWithoutSharp ? 'passthrough_no_metadata' : 'rejected_no_metadata',
					)
					return fitsWithoutSharp ? { buffer, mediaType, resized: false } : null
				}

				const width = metadata.width ?? 0
				const height = metadata.height ?? 0
				span.setAttributes({
					'copilot.vfs.input.width': width,
					'copilot.vfs.input.height': height,
				})

				const needsResize =
					buffer.length > MAX_IMAGE_READ_BYTES ||
					width > MAX_IMAGE_DIMENSION ||
					height > MAX_IMAGE_DIMENSION
				if (!needsResize) {
					span.setAttributes({
						'copilot.vfs.resized': false,
						'copilot.vfs.outcome': 'passthrough_fits_budget',
						'copilot.vfs.output.bytes': buffer.length,
						'copilot.vfs.output.media_type': mediaType,
					})
					return { buffer, mediaType, resized: false }
				}

				const hasAlpha = Boolean(
					metadata.hasAlpha ||
						mediaType === 'image/png' ||
						mediaType === 'image/webp' ||
						mediaType === 'image/gif'
				)
				span.setAttribute('copilot.vfs.has_alpha', hasAlpha)

				let attempts = 0
				for (const dimension of IMAGE_RESIZE_DIMENSIONS) {
					for (const quality of IMAGE_QUALITY_STEPS) {
						attempts += 1
						try {
							const pipeline = sharpModule(buffer, { limitInputPixels: false })
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

							span.addEvent('copilot.vfs.resize_attempt', {
								'copilot.vfs.resize.dimension': dimension,
								'copilot.vfs.resize.quality': quality,
								'copilot.vfs.resize.output_bytes': transformed.buffer.length,
								'copilot.vfs.resize.fits_budget':
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
									'copilot.vfs.resized': true,
									'copilot.vfs.resize.attempts': attempts,
									'copilot.vfs.resize.chosen_dimension': dimension,
									'copilot.vfs.resize.chosen_quality': quality,
									'copilot.vfs.output.bytes': transformed.buffer.length,
									'copilot.vfs.output.media_type': transformed.mediaType,
									'copilot.vfs.outcome': 'resized',
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
								error: err instanceof Error ? err.message : String(err),
							})
							span.addEvent('copilot.vfs.resize_attempt_failed', {
								'copilot.vfs.resize.dimension': dimension,
								'copilot.vfs.resize.quality': quality,
								'error.message':
									err instanceof Error ? err.message : String(err).slice(0, 500),
							})
						}
					}
				}

				span.setAttributes({
					'copilot.vfs.resized': false,
					'copilot.vfs.resize.attempts': attempts,
					'copilot.vfs.outcome': 'rejected_too_large_after_resize',
				})
				return null
			} catch (err) {
				recordSpanError(span, err)
				throw err
			} finally {
				span.end()
			}
		},
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
        'copilot.vfs.file.name': record.name,
        'copilot.vfs.file.media_type': record.type,
        'copilot.vfs.file.size_bytes': record.size,
        'copilot.vfs.file.extension': getExtension(record.name),
      },
    },
    async (span) => {
      try {
        if (isImageFileType(record.type)) {
          span.setAttribute('copilot.vfs.read.path', 'image')
          const originalBuffer = await downloadWorkspaceFile(record)
          const prepared = await prepareImageForVision(originalBuffer, record.type)
          if (!prepared) {
            span.setAttribute('copilot.vfs.read.outcome', 'image_too_large')
            return {
              content: `[Image too large: ${record.name} (${(record.size / 1024 / 1024).toFixed(1)}MB, limit 5MB after resize/compression)]`,
              totalLines: 1,
            }
          }
          const sizeKb = (prepared.buffer.length / 1024).toFixed(1)
          const resizeNote = prepared.resized ? ', resized for vision' : ''
          span.setAttributes({
            'copilot.vfs.read.outcome': 'image_prepared',
            'copilot.vfs.read.output.bytes': prepared.buffer.length,
            'copilot.vfs.read.output.media_type': prepared.mediaType,
            'copilot.vfs.read.image.resized': prepared.resized,
          })
          return {
            content: `Image: ${record.name} (${sizeKb}KB, ${prepared.mediaType}${resizeNote})`,
            totalLines: 1,
            attachment: {
              type: 'image',
              source: {
                type: 'base64',
                media_type: prepared.mediaType,
                data: prepared.buffer.toString('base64'),
              },
            },
          }
        }

        if (isReadableType(record.type)) {
          span.setAttribute('copilot.vfs.read.path', 'text')
          if (record.size > MAX_TEXT_READ_BYTES) {
            span.setAttribute('copilot.vfs.read.outcome', 'text_too_large')
            return {
              content: `[File too large to display inline: ${record.name} (${record.size} bytes, limit ${MAX_TEXT_READ_BYTES})]`,
              totalLines: 1,
            }
          }

          const buffer = await downloadWorkspaceFile(record)
          const content = buffer.toString('utf-8')
          const lines = content.split('\n').length
          span.setAttributes({
            'copilot.vfs.read.outcome': 'text_read',
            'copilot.vfs.read.output.bytes': buffer.length,
            'copilot.vfs.read.output.lines': lines,
          })
          return { content, totalLines: lines }
        }

        const ext = getExtension(record.name)
        if (PARSEABLE_EXTENSIONS.has(ext)) {
          span.setAttribute('copilot.vfs.read.path', 'parseable_document')
          const buffer = await downloadWorkspaceFile(record)
          try {
            const { parseBuffer } = await import('@/lib/file-parsers')
            const result = await parseBuffer(buffer, ext)
            const content = result.content || ''
            const lines = content.split('\n').length
            span.setAttributes({
              'copilot.vfs.read.outcome': 'document_parsed',
              'copilot.vfs.read.output.bytes': content.length,
              'copilot.vfs.read.output.lines': lines,
            })
            return { content, totalLines: lines }
          } catch (parseErr) {
            logger.warn('Failed to parse document', {
              fileName: record.name,
              ext,
              error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            })
            span.addEvent('copilot.vfs.parse_failed', {
              'error.message':
                parseErr instanceof Error
                  ? parseErr.message
                  : String(parseErr).slice(0, 500),
            })
            span.setAttribute('copilot.vfs.read.outcome', 'parse_failed')
            return {
              content: `[Could not parse ${record.name} (${record.type}, ${record.size} bytes)]`,
              totalLines: 1,
            }
          }
        }

        span.setAttributes({
          'copilot.vfs.read.path': 'binary',
          'copilot.vfs.read.outcome': 'binary_placeholder',
        })
        return {
          content: `[Binary file: ${record.name} (${record.type}, ${record.size} bytes). Cannot display as text.]`,
          totalLines: 1,
        }
      } catch (err) {
        logger.warn('Failed to read workspace file', {
          fileName: record.name,
          error: err instanceof Error ? err.message : String(err),
        })
        recordSpanError(span, err)
        span.setAttribute('copilot.vfs.read.outcome', 'read_failed')
        return null
      } finally {
        span.end()
      }
    },
  )
}
