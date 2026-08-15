import { createLogger } from '@sim/logger'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('CopilotFileManager')

const SUPPORTED_FILE_TYPES = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'application/json',
  'application/xml',
  'text/xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/x-pptxgenjs',
  'text/x-docxjs',
  'text/x-python-pdf',
  'text/x-python-xlsx',
]

/**
 * Check if a MIME type is supported for copilot attachments
 */
export function isSupportedFileType(mimeType: string): boolean {
  return SUPPORTED_FILE_TYPES.includes(mimeType.toLowerCase())
}

export interface CopilotStoredFile {
  id: string
  key: string
  context: 'copilot'
  name: string
  url: string
  size: number
  type: string
  mimeType: string
}

export async function uploadCopilotFile(options: {
  buffer: Buffer
  fileName: string
  contentType: string
  userId: string
}): Promise<CopilotStoredFile> {
  const fileInfo = await uploadFile({
    file: options.buffer,
    fileName: options.fileName,
    contentType: options.contentType,
    context: 'copilot',
    metadata: {
      userId: options.userId,
      originalName: options.fileName,
      uploadedAt: new Date().toISOString(),
      purpose: 'copilot-tool-output',
    },
  })

  const url = `${getBaseUrl()}${fileInfo.path}`

  logger.info(`Stored copilot tool output: ${options.fileName}`, {
    key: fileInfo.key,
    size: fileInfo.size,
    userId: options.userId,
  })

  return {
    id: fileInfo.key,
    key: fileInfo.key,
    context: 'copilot',
    name: fileInfo.name,
    url,
    size: fileInfo.size,
    type: fileInfo.type,
    mimeType: fileInfo.type,
  }
}

/**
 * Download a copilot file from storage
 *
 * Uses the unified storage service with explicit copilot context.
 * Handles S3, Azure Blob, and local storage automatically.
 *
 * @param key File storage key
 * @returns File buffer
 * @throws Error if file not found or download fails
 */
export async function downloadCopilotFile(key: string): Promise<Buffer> {
  try {
    const fileBuffer = await downloadFile({
      key,
      context: 'copilot',
    })

    logger.info(`Successfully downloaded copilot file: ${key}`, {
      size: fileBuffer.length,
    })

    return fileBuffer
  } catch (error) {
    logger.error(`Failed to download copilot file: ${key}`, error)
    throw error
  }
}
