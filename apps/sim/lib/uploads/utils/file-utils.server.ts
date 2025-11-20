'use server'

import type { Logger } from '@/lib/logs/console/logger'
import type { StorageContext } from '@/lib/uploads'
import { isExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-helpers'
import type { UserFile } from '@/executor/types'
import { inferContextFromKey } from './file-utils'

/**
 * Download a file from a URL (internal or external)
 * For internal URLs, uses direct storage access (server-side only)
 * For external URLs, uses HTTP fetch
 */
export async function downloadFileFromUrl(fileUrl: string, timeoutMs = 180000): Promise<Buffer> {
  const { isInternalFileUrl } = await import('./file-utils')
  const { parseInternalFileUrl } = await import('./file-utils')
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    if (isInternalFileUrl(fileUrl)) {
      const { key, context } = parseInternalFileUrl(fileUrl)
      const { downloadFile } = await import('@/lib/uploads/core/storage-service')
      const buffer = await downloadFile({ key, context })
      clearTimeout(timeoutId)
      return buffer
    }

    const response = await fetch(fileUrl, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`)
    }

    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('File download timed out')
    }
    throw error
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
