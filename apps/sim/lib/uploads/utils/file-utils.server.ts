'use server'

import type { Logger } from '@sim/logger'
import { secureFetchWithPinnedIP, validateUrlWithDNS } from '@/lib/core/security/input-validation'
import type { StorageContext } from '@/lib/uploads'
import { isExecutionFile } from '@/lib/uploads/contexts/execution/utils'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'

/**
 * Download a file from a URL (internal or external)
 * For internal URLs, uses direct storage access (server-side only)
 * For external URLs, validates DNS/SSRF and uses secure fetch with IP pinning
 */
export async function downloadFileFromUrl(fileUrl: string, timeoutMs = 180000): Promise<Buffer> {
  const { isInternalFileUrl } = await import('./file-utils')
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
