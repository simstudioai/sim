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
      return {
        content: `Image: ${record.name} (${(record.size / 1024).toFixed(1)}KB, ${record.type})`,
        totalLines: 1,
        attachment: {
          type: 'image',
          source: {
            type: 'base64',
            media_type: record.type,
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
