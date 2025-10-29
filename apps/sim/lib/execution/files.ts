import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import type { UserFile } from '@/executor/types'

const logger = createLogger('ExecutionFiles')

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

/**
 * Process a single file for workflow execution - handles both base64 ('file' type) and URL pass-through ('url' type)
 */
export async function processExecutionFile(
  file: { type: string; data: string; name: string; mime?: string },
  executionContext: { workspaceId: string; workflowId: string; executionId: string },
  requestId: string,
  isAsync?: boolean
): Promise<UserFile | null> {
  if (file.type === 'file' && file.data && file.name) {
    const dataUrlPrefix = 'data:'
    const base64Prefix = ';base64,'

    if (!file.data.startsWith(dataUrlPrefix)) {
      logger.warn(`[${requestId}] Invalid data format for file: ${file.name}`)
      return null
    }

    const base64Index = file.data.indexOf(base64Prefix)
    if (base64Index === -1) {
      logger.warn(`[${requestId}] Invalid data format (no base64 marker) for file: ${file.name}`)
      return null
    }

    const mimeType = file.data.substring(dataUrlPrefix.length, base64Index)
    const base64Data = file.data.substring(base64Index + base64Prefix.length)
    const buffer = Buffer.from(base64Data, 'base64')

    if (buffer.length > MAX_FILE_SIZE) {
      const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
      throw new Error(
        `File "${file.name}" exceeds the maximum size limit of 20MB (actual size: ${fileSizeMB}MB)`
      )
    }

    logger.debug(`[${requestId}] Uploading file: ${file.name} (${buffer.length} bytes)`)

    const userFile = await uploadExecutionFile(
      executionContext,
      buffer,
      file.name,
      mimeType || file.mime || 'application/octet-stream',
      isAsync
    )

    logger.debug(`[${requestId}] Successfully uploaded ${file.name}`)
    return userFile
  }

  if (file.type === 'url' && file.data) {
    return {
      id: uuidv4(),
      url: file.data,
      name: file.name,
      size: 0,
      type: file.mime || 'application/octet-stream',
      key: `url/${file.name}`,
      uploadedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }
  }

  return null
}

/**
 * Process all files for a given field in workflow execution input
 */
export async function processExecutionFiles(
  fieldValue: any,
  executionContext: { workspaceId: string; workflowId: string; executionId: string },
  requestId: string,
  isAsync?: boolean
): Promise<UserFile[]> {
  if (!fieldValue || typeof fieldValue !== 'object') {
    return []
  }

  const files = Array.isArray(fieldValue) ? fieldValue : [fieldValue]
  const uploadedFiles: UserFile[] = []
  const fullContext = { ...executionContext }

  for (const file of files) {
    try {
      const userFile = await processExecutionFile(file, fullContext, requestId, isAsync)

      if (userFile) {
        uploadedFiles.push(userFile)
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to process file ${file.name}:`, error)
      throw new Error(`Failed to upload file: ${file.name}`)
    }
  }

  return uploadedFiles
}
