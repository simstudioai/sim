import { createLogger } from '@sim/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'

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

async function prepareImageForVision(
	buffer: Buffer,
	claimedType: string
): Promise<PreparedVisionImage | null> {
	const mediaType = detectImageMime(buffer, claimedType)

	let sharpModule: typeof import('sharp').default
	try {
		sharpModule = (await import('sharp')).default
	} catch (err) {
		logger.warn('Failed to load sharp for image preparation', {
			mediaType,
			error: err instanceof Error ? err.message : String(err),
		})
		return buffer.length <= MAX_IMAGE_READ_BYTES ? { buffer, mediaType, resized: false } : null
	}

	let metadata: Awaited<ReturnType<ReturnType<typeof sharpModule>['metadata']>>
	try {
		metadata = await sharpModule(buffer, { limitInputPixels: false }).metadata()
	} catch (err) {
		logger.warn('Failed to read image metadata for VFS read', {
			mediaType,
			error: err instanceof Error ? err.message : String(err),
		})
		return buffer.length <= MAX_IMAGE_READ_BYTES ? { buffer, mediaType, resized: false } : null
	}

	const width = metadata.width ?? 0
	const height = metadata.height ?? 0
	const needsResize =
		buffer.length > MAX_IMAGE_READ_BYTES ||
		width > MAX_IMAGE_DIMENSION ||
		height > MAX_IMAGE_DIMENSION
	if (!needsResize) {
		return { buffer, mediaType, resized: false }
	}

	const hasAlpha = Boolean(
		metadata.hasAlpha ||
			mediaType === 'image/png' ||
			mediaType === 'image/webp' ||
			mediaType === 'image/gif'
	)

	for (const dimension of IMAGE_RESIZE_DIMENSIONS) {
		for (const quality of IMAGE_QUALITY_STEPS) {
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
			}
		}
	}

	return null
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
 */
export async function readFileRecord(record: WorkspaceFileRecord): Promise<FileReadResult | null> {
  try {
		if (isImageFileType(record.type)) {
			const originalBuffer = await downloadWorkspaceFile(record)
			const prepared = await prepareImageForVision(originalBuffer, record.type)
			if (!prepared) {
				return {
					content: `[Image too large: ${record.name} (${(record.size / 1024 / 1024).toFixed(1)}MB, limit 5MB after resize/compression)]`,
					totalLines: 1,
				}
			}
			const sizeKb = (prepared.buffer.length / 1024).toFixed(1)
			const resizeNote = prepared.resized ? ', resized for vision' : ''
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
      if (record.size > MAX_TEXT_READ_BYTES) {
        return {
          content: `[File too large to display inline: ${record.name} (${record.size} bytes, limit ${MAX_TEXT_READ_BYTES})]`,
          totalLines: 1,
        }
      }

      const buffer = await downloadWorkspaceFile(record)
      const content = buffer.toString('utf-8')
      return { content, totalLines: content.split('\n').length }
    }

    const ext = getExtension(record.name)
    if (PARSEABLE_EXTENSIONS.has(ext)) {
      const buffer = await downloadWorkspaceFile(record)
      try {
        const { parseBuffer } = await import('@/lib/file-parsers')
        const result = await parseBuffer(buffer, ext)
        const content = result.content || ''
        return { content, totalLines: content.split('\n').length }
      } catch (parseErr) {
        logger.warn('Failed to parse document', {
          fileName: record.name,
          ext,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        })
        return {
          content: `[Could not parse ${record.name} (${record.type}, ${record.size} bytes)]`,
          totalLines: 1,
        }
      }
    }

    return {
      content: `[Binary file: ${record.name} (${record.type}, ${record.size} bytes). Cannot display as text.]`,
      totalLines: 1,
    }
  } catch (err) {
    logger.warn('Failed to read workspace file', {
      fileName: record.name,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
