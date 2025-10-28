import type { Logger } from '@/lib/logs/console/logger'
import { extractStorageKey } from '@/lib/uploads/file-utils'
import { downloadFile } from '@/lib/uploads/storage-client'
import { downloadExecutionFile } from '@/lib/workflows/execution-files'
import { isExecutionFile } from '@/lib/workflows/execution-files/execution-files'
import type { UserFile } from '@/executor/types'

/**
 * Converts a single raw file object to UserFile format
 * @param file - Raw file object
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns UserFile object
 * @throws Error if file has no storage key
 */
export function processSingleFileToUserFile(
  file: any,
  requestId: string,
  logger: Logger
): UserFile {
  // Already a UserFile (from variable reference)
  if (file.id && file.key && file.uploadedAt) {
    return file as UserFile
  }

  // Extract storage key from path or key property
  const storageKey = file.key || (file.path ? extractStorageKey(file.path) : null)

  if (!storageKey) {
    logger.warn(`[${requestId}] File has no storage key: ${file.name || 'unknown'}`)
    throw new Error(`File has no storage key: ${file.name || 'unknown'}`)
  }

  const userFile: UserFile = {
    id: file.id || `file-${Date.now()}`,
    name: file.name,
    url: file.url || file.path,
    size: file.size,
    type: file.type || 'application/octet-stream',
    key: storageKey,
    uploadedAt: file.uploadedAt || new Date().toISOString(),
    expiresAt: file.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }

  logger.info(`[${requestId}] Converted file to UserFile: ${userFile.name} (key: ${userFile.key})`)
  return userFile
}

/**
 * Converts raw file objects (from file-upload or variable references) to UserFile format
 * @param files - Array of raw file objects
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns Array of UserFile objects
 */
export function processFilesToUserFiles(
  files: any[],
  requestId: string,
  logger: Logger
): UserFile[] {
  const userFiles: UserFile[] = []

  for (const file of files) {
    try {
      const userFile = processSingleFileToUserFile(file, requestId, logger)
      userFiles.push(userFile)
    } catch (error) {
      // Log and skip files that can't be processed
      logger.warn(
        `[${requestId}] Skipping file: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  return userFiles
}

/**
 * Downloads a file from storage (execution or regular)
 * @param userFile - UserFile object
 * @param requestId - Request ID for logging
 * @param logger - Logger instance
 * @returns Buffer containing file data
 */
export async function downloadFileFromStorage(
  userFile: UserFile,
  requestId: string,
  logger: Logger
): Promise<Buffer> {
  let buffer: Buffer

  if (isExecutionFile(userFile)) {
    logger.info(`[${requestId}] Downloading from execution storage: ${userFile.key}`)
    buffer = await downloadExecutionFile(userFile)
  } else if (userFile.key) {
    logger.info(`[${requestId}] Downloading from regular storage: ${userFile.key}`)
    buffer = await downloadFile(userFile.key)
  } else {
    throw new Error('File has no key - cannot download')
  }

  return buffer
}
