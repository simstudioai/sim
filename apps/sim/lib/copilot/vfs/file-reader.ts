import { createLogger } from '@sim/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FileReader')

const MAX_TEXT_READ_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_IMAGE_READ_BYTES = 5 * 1024 * 1024 // 5 MB

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
      if (record.size > MAX_IMAGE_READ_BYTES) {
        return {
          content: `[Image too large: ${record.name} (${(record.size / 1024 / 1024).toFixed(1)}MB, limit 5MB)]`,
          totalLines: 1,
        }
      }
      const buffer = await downloadWorkspaceFile(record)
      const mime = detectImageMime(buffer, record.type)
      return {
        content: `Image: ${record.name} (${(record.size / 1024).toFixed(1)}KB, ${mime})`,
        totalLines: 1,
        attachment: {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mime,
            data: buffer.toString('base64'),
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
