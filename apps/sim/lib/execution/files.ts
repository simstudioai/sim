import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import type { UserFile } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ExecutionFiles')

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

/**
 * Process a single file for workflow execution - handles both base64 ('file' type) and URL pass-through ('url' type)
 */
export async function processExecutionFile(
  file: { type: string; data: string; name: string; mime?: string },
  executionContext: { workspaceId: string; workflowId: string; executionId: string },
  requestId: string,
  userId?: string
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
      userId
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
  userId?: string
): Promise<UserFile[]> {
  if (!fieldValue || typeof fieldValue !== 'object') {
    return []
  }

  const files = Array.isArray(fieldValue) ? fieldValue : [fieldValue]
  const uploadedFiles: UserFile[] = []
  const fullContext = { ...executionContext }

  for (const file of files) {
    try {
      const userFile = await processExecutionFile(file, fullContext, requestId, userId)

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

/**
 * Extract inputFormat fields from a start block or trigger block
 */
type ValidatedInputFormatField = Required<Pick<InputFormatField, 'name' | 'type'>>

function extractInputFormatFromBlock(block: SerializedBlock): ValidatedInputFormatField[] {
  const inputFormatValue = block.config?.params?.inputFormat

  if (!Array.isArray(inputFormatValue) || inputFormatValue.length === 0) {
    return []
  }

  return inputFormatValue.filter(
    (field): field is ValidatedInputFormatField =>
      field &&
      typeof field === 'object' &&
      'name' in field &&
      'type' in field &&
      typeof field.name === 'string' &&
      typeof field.type === 'string'
  )
}

/**
 * Process file fields in workflow input based on the start block's inputFormat
 * This handles base64 and URL file inputs from API calls
 */
export async function processInputFileFields(
  input: unknown,
  blocks: SerializedBlock[],
  executionContext: { workspaceId: string; workflowId: string; executionId: string },
  requestId: string,
  userId?: string
): Promise<unknown> {
  if (!input || typeof input !== 'object' || blocks.length === 0) {
    return input
  }

  const startBlock = blocks.find((block) => {
    const blockType = block.metadata?.id
    return (
      blockType === TRIGGER_TYPES.START ||
      blockType === TRIGGER_TYPES.API ||
      blockType === TRIGGER_TYPES.INPUT ||
      blockType === TRIGGER_TYPES.GENERIC_WEBHOOK ||
      blockType === TRIGGER_TYPES.STARTER
    )
  })

  if (!startBlock) {
    return input
  }

  const inputFormat = extractInputFormatFromBlock(startBlock)
  const fileFields = inputFormat.filter((field) => field.type === 'files')

  if (fileFields.length === 0) {
    return input
  }

  const processedInput = { ...input } as Record<string, unknown>

  for (const fileField of fileFields) {
    const fieldValue = processedInput[fileField.name]

    if (fieldValue && typeof fieldValue === 'object') {
      const uploadedFiles = await processExecutionFiles(
        fieldValue,
        executionContext,
        requestId,
        userId
      )

      if (uploadedFiles.length > 0) {
        processedInput[fileField.name] = uploadedFiles
        logger.info(
          `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`
        )
      }
    }
  }

  return processedInput
}
