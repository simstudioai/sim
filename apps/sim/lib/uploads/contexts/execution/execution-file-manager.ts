import { createLogger } from '@sim/logger'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import { StorageService } from '@/lib/uploads'
import type { ExecutionContext } from '@/lib/uploads/contexts/execution/utils'
import { generateExecutionFileKey, generateFileId } from '@/lib/uploads/contexts/execution/utils'
import type { UserFile } from '@/executor/types'

const logger = createLogger('ExecutionFileStorage')

function isSerializedBuffer(value: unknown): value is { type: string; data: number[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  )
}

function toBuffer(data: unknown, fileName: string): Buffer {
  if (data === undefined || data === null) {
    throw new Error(`File '${fileName}' has no data`)
  }

  if (Buffer.isBuffer(data)) {
    return data
  }

  if (isSerializedBuffer(data)) {
    return Buffer.from(data.data)
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data)
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }

  if (Array.isArray(data)) {
    return Buffer.from(data)
  }

  if (typeof data === 'string') {
    const trimmed = data.trim()
    if (trimmed.startsWith('data:')) {
      const [, base64Data] = trimmed.split(',')
      return Buffer.from(base64Data ?? '', 'base64')
    }
    return Buffer.from(trimmed, 'base64')
  }

  throw new Error(`File '${fileName}' has unsupported data format: ${typeof data}`)
}

/**
 * Upload a file to execution-scoped storage
 */
export async function uploadExecutionFile(
  context: ExecutionContext,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  userId?: string
): Promise<UserFile> {
  logger.info(`Uploading execution file: ${fileName} for execution ${context.executionId}`)
  logger.debug(`File upload context:`, {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    userId: userId || 'not provided',
    fileName,
    bufferSize: fileBuffer.length,
  })

  const storageKey = generateExecutionFileKey(context, fileName)
  const fileId = generateFileId()

  logger.info(`Generated storage key: "${storageKey}" for file: ${fileName}`)

  const metadata: Record<string, string> = {
    originalName: fileName,
    uploadedAt: new Date().toISOString(),
    purpose: 'execution',
    workspaceId: context.workspaceId,
  }

  if (userId) {
    metadata.userId = userId
  }

  try {
    const fileInfo = await StorageService.uploadFile({
      file: fileBuffer,
      fileName: storageKey,
      contentType,
      context: 'execution',
      preserveKey: true, // Don't add timestamp prefix
      customKey: storageKey, // Use exact execution-scoped key
      metadata, // Pass metadata for cloud storage and database tracking
    })

    const presignedUrl = await StorageService.generatePresignedDownloadUrl(
      fileInfo.key,
      'execution',
      5 * 60
    )

    const userFile: UserFile = {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: presignedUrl,
      key: fileInfo.key,
      context: 'execution',
      base64: fileBuffer.toString('base64'),
    }

    logger.info(`Successfully uploaded execution file: ${fileName} (${fileBuffer.length} bytes)`, {
      key: fileInfo.key,
    })
    return userFile
  } catch (error) {
    logger.error(`Failed to upload execution file ${fileName}:`, error)
    throw new Error(
      `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Download a file from execution-scoped storage
 */
export async function downloadExecutionFile(userFile: UserFile): Promise<Buffer> {
  logger.info(`Downloading execution file: ${userFile.name}`)

  try {
    const fileBuffer = await StorageService.downloadFile({
      key: userFile.key,
      context: 'execution',
    })

    logger.info(
      `Successfully downloaded execution file: ${userFile.name} (${fileBuffer.length} bytes)`
    )
    return fileBuffer
  } catch (error) {
    logger.error(`Failed to download execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Convert raw file data (from tools/triggers) to UserFile
 * Handles all common formats: Buffer, serialized Buffer, base64, data URLs
 */
export async function uploadFileFromRawData(
  rawData: {
    name?: string
    filename?: string
    data?: unknown
    mimeType?: string
    contentType?: string
    size?: number
  },
  context: ExecutionContext,
  userId?: string
): Promise<UserFile> {
  if (isUserFileWithMetadata(rawData)) {
    return rawData
  }

  const fileName = rawData.name || rawData.filename || 'file.bin'
  const buffer = toBuffer(rawData.data, fileName)
  const contentType = rawData.mimeType || rawData.contentType || 'application/octet-stream'

  return uploadExecutionFile(context, buffer, fileName, contentType, userId)
}
