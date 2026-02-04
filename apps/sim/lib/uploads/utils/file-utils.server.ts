'use server'

import type { Logger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { StorageContext } from '@/lib/uploads'
import { StorageService } from '@/lib/uploads'
import { isExecutionFile } from '@/lib/uploads/contexts/execution/utils'
import {
  extractStorageKey,
  inferContextFromKey,
  isInternalFileUrl,
  processSingleFileToUserFile,
  type RawFileInput,
} from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import type { UserFile } from '@/executor/types'

/**
 * Result type for file input resolution
 */
export interface FileResolutionResult {
  fileUrl?: string
  error?: {
    status: number
    message: string
  }
}

/**
 * Options for resolving file input to a URL
 */
export interface ResolveFileInputOptions {
  file?: RawFileInput
  filePath?: string
  userId: string
  requestId: string
  logger: Logger
}

/**
 * Resolves file input (either a file object or filePath string) to a publicly accessible URL.
 * Handles:
 * - Processing raw file input via processSingleFileToUserFile
 * - Resolving internal URLs via resolveInternalFileUrl
 * - Generating presigned URLs for storage keys
 * - Validating external URLs via validateUrlWithDNS
 */
export async function resolveFileInputToUrl(
  options: ResolveFileInputOptions
): Promise<FileResolutionResult> {
  const { file, filePath, userId, requestId, logger } = options

  if (file) {
    let userFile: UserFile
    try {
      userFile = processSingleFileToUserFile(file, requestId, logger)
    } catch (error) {
      return {
        error: {
          status: 400,
          message: error instanceof Error ? error.message : 'Failed to process file',
        },
      }
    }

    let fileUrl = userFile.url || ''

    // Handle internal URLs
    if (fileUrl && isInternalFileUrl(fileUrl)) {
      const resolution = await resolveInternalFileUrl(fileUrl, userId, requestId, logger)
      if (resolution.error) {
        return { error: resolution.error }
      }
      fileUrl = resolution.fileUrl || ''
    }

    // Generate presigned URL if we have a key but no URL
    if (!fileUrl && userFile.key) {
      const context = (userFile.context as StorageContext) || inferContextFromKey(userFile.key)
      const hasAccess = await verifyFileAccess(userFile.key, userId, undefined, context, false)

      if (!hasAccess) {
        logger.warn(`[${requestId}] Unauthorized presigned URL generation attempt`, {
          userId,
          key: userFile.key,
          context,
        })
        return { error: { status: 404, message: 'File not found' } }
      }

      fileUrl = await StorageService.generatePresignedDownloadUrl(userFile.key, context, 5 * 60)
    }

    return { fileUrl }
  }

  if (filePath) {
    let fileUrl = filePath

    if (isInternalFileUrl(filePath)) {
      const resolution = await resolveInternalFileUrl(filePath, userId, requestId, logger)
      if (resolution.error) {
        return { error: resolution.error }
      }
      fileUrl = resolution.fileUrl || fileUrl
    } else if (filePath.startsWith('/')) {
      logger.warn(`[${requestId}] Invalid internal path`, {
        userId,
        path: filePath.substring(0, 50),
      })
      return {
        error: {
          status: 400,
          message: 'Invalid file path. Only uploaded files are supported for internal paths.',
        },
      }
    } else {
      const urlValidation = await validateUrlWithDNS(fileUrl, 'filePath')
      if (!urlValidation.isValid) {
        return { error: { status: 400, message: urlValidation.error || 'Invalid URL' } }
      }
    }

    return { fileUrl }
  }

  return { error: { status: 400, message: 'File input is required' } }
}

/**
 * Download a file from a URL (internal or external)
 * For internal URLs, uses direct storage access (server-side only)
 * For external URLs, validates DNS/SSRF and uses secure fetch with IP pinning
 */
export async function downloadFileFromUrl(fileUrl: string, timeoutMs = 180000): Promise<Buffer> {
  const { parseInternalFileUrl } = await import('./file-utils')

  if (isInternalFileUrl(fileUrl)) {
    const { key, context } = parseInternalFileUrl(fileUrl)
    const { downloadFile } = await import('@/lib/uploads/core/storage-service')
    return downloadFile({ key, context })
  }

  const urlValidation = await validateUrlWithDNS(fileUrl, 'fileUrl')
  if (!urlValidation.isValid) {
    throw new Error(`Invalid file URL: ${urlValidation.error}`)
  }

  const response = await secureFetchWithPinnedIP(fileUrl, urlValidation.resolvedIP!, {
    timeout: timeoutMs,
  })

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

export async function resolveInternalFileUrl(
  filePath: string,
  userId: string,
  requestId: string,
  logger: Logger
): Promise<{ fileUrl?: string; error?: { status: number; message: string } }> {
  if (!isInternalFileUrl(filePath)) {
    return { fileUrl: filePath }
  }

  try {
    const storageKey = extractStorageKey(filePath)
    const context = inferContextFromKey(storageKey)
    const hasAccess = await verifyFileAccess(storageKey, userId, undefined, context, false)

    if (!hasAccess) {
      logger.warn(`[${requestId}] Unauthorized presigned URL generation attempt`, {
        userId,
        key: storageKey,
        context,
      })
      return { error: { status: 404, message: 'File not found' } }
    }

    const fileUrl = await StorageService.generatePresignedDownloadUrl(storageKey, context, 5 * 60)
    logger.info(`[${requestId}] Generated presigned URL for ${context} file`)
    return { fileUrl }
  } catch (error) {
    logger.error(`[${requestId}] Failed to generate presigned URL:`, error)
    return { error: { status: 500, message: 'Failed to generate file access URL' } }
  }
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
    const { downloadExecutionFile } = await import(
      '@/lib/uploads/contexts/execution/execution-file-manager'
    )
    buffer = await downloadExecutionFile(userFile)
  } else if (userFile.key) {
    const context = (userFile.context as StorageContext) || inferContextFromKey(userFile.key)
    logger.info(
      `[${requestId}] Downloading from ${context} storage (${userFile.context ? 'explicit' : 'inferred'}): ${userFile.key}`
    )

    const { downloadFile } = await import('@/lib/uploads/core/storage-service')
    buffer = await downloadFile({
      key: userFile.key,
      context,
    })
  } else {
    throw new Error('File has no key - cannot download')
  }

  return buffer
}
