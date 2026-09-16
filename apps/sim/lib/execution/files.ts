import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import { generatePresignedDownloadUrl } from '@/lib/uploads/core/storage-service'
import { getFileMetadataById, getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'
import {
  extractWorkspaceIdFromStorageKey,
  inferContextFromKey,
  isInternalFileUrl,
  parseInternalFileUrl,
} from '@/lib/uploads/utils/file-utils'
import { workflowFileInputSchema } from '@/lib/workflows/input-file-schema'
import { isFileFieldType } from '@/lib/workflows/input-format'
import { TRIGGER_TYPES } from '@/lib/workflows/triggers/triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import type { UserFile } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ExecutionFiles')

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

/**
 * Process a single file for workflow execution - handles base64 ('file' type) and URL downloads ('url' type)
 */
export async function processExecutionFile(
  fileInput: unknown,
  executionContext: { workspaceId: string; workflowId: string; executionId: string },
  requestId: string,
  userId?: string
): Promise<UserFile | null> {
  const parsed = workflowFileInputSchema.safeParse(fileInput)
  if (!parsed.success) throw new Error('Invalid workflow file input')
  const candidate = parsed.data
  if (!('data' in candidate) || typeof candidate.data !== 'string') {
    let key = 'key' in candidate && typeof candidate.key === 'string' ? candidate.key : undefined
    if (
      !key &&
      'url' in candidate &&
      typeof candidate.url === 'string' &&
      isInternalFileUrl(candidate.url)
    ) {
      key = parseInternalFileUrl(candidate.url).key
    }
    const id = 'id' in candidate && typeof candidate.id === 'string' ? candidate.id : undefined
    const record = key ? await getFileMetadataByKey(key) : id ? await getFileMetadataById(id) : null
    if (
      !record ||
      record.deletedAt ||
      record.workspaceId !== executionContext.workspaceId ||
      extractWorkspaceIdFromStorageKey(record.key) !== executionContext.workspaceId ||
      (record.context !== 'workspace' &&
        record.context !== 'mothership' &&
        record.context !== 'execution')
    ) {
      throw new Error('File not found in this workspace')
    }
    const storageContext = inferContextFromKey(record.key)
    return {
      id: record.id,
      name: record.originalName,
      type: record.contentType,
      size: getWorkspaceFileSize(record),
      key: record.key,
      context: storageContext,
      url: await generatePresignedDownloadUrl(record.key, storageContext, 5 * 60),
    }
  }
  const upload =
    'mimeType' in candidate && typeof candidate.mimeType === 'string'
      ? {
          type: 'file',
          name: candidate.name,
          data: candidate.data.startsWith('data:')
            ? candidate.data
            : `data:${candidate.mimeType};base64,${candidate.data}`,
          mime: candidate.mimeType,
        }
      : candidate
  if (
    !('type' in upload) ||
    !('name' in upload) ||
    typeof upload.name !== 'string' ||
    typeof upload.data !== 'string'
  ) {
    throw new Error('Invalid workflow upload input')
  }
  const file = {
    type: upload.type,
    data: upload.data,
    name: upload.name,
    mime: 'mime' in upload && typeof upload.mime === 'string' ? upload.mime : undefined,
  }
  if (file.type === 'file' && file.data && file.name) {
    const dataUrlPrefix = 'data:'
    const base64Prefix = ';base64,'

    if (!file.data.startsWith(dataUrlPrefix)) {
      throw new Error(`Invalid data URL for file: ${file.name}`)
    }

    const base64Index = file.data.indexOf(base64Prefix)
    if (base64Index === -1) {
      throw new Error(`Missing base64 marker for file: ${file.name}`)
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

    const userFile = await uploadExecutionFile(
      executionContext,
      buffer,
      file.name,
      mimeType || file.mime || 'application/octet-stream',
      userId
    )

    return userFile
  }

  if (file.type === 'url' && file.data) {
    const { downloadFileFromUrl } = await import('@/lib/uploads/utils/file-utils.server')
    const buffer = await withResourceOutboundScope(executionContext, () =>
      downloadFileFromUrl(file.data, { userId })
    )

    if (buffer.length > MAX_FILE_SIZE) {
      const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
      throw new Error(
        `File "${file.name}" exceeds the maximum size limit of 20MB (actual size: ${fileSizeMB}MB)`
      )
    }

    const userFile = await uploadExecutionFile(
      executionContext,
      buffer,
      file.name,
      file.mime || 'application/octet-stream',
      userId
    )

    return userFile
  }

  return null
}

/**
 * Process all files for a given field in workflow execution input
 */
export async function processExecutionFiles(
  fieldValue: unknown,
  executionContext: { workspaceId: string; workflowId: string; executionId: string },
  requestId: string,
  userId?: string
): Promise<UserFile[]> {
  if (fieldValue === undefined || fieldValue === null) return []
  if (typeof fieldValue !== 'object') throw new Error('Workflow files must be file objects')

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
      logger.error(`[${requestId}] Failed to process workflow file`, error)
      throw new Error(`Failed to process workflow file: ${getErrorMessage(error, 'Invalid file')}`)
    }
  }

  return uploadedFiles
}

/**
 * Extract inputFormat fields from a start block or trigger block
 */
type ValidatedInputFormatField = Required<Pick<InputFormatField, 'name' | 'type'>> &
  Pick<InputFormatField, 'value'>

function extractInputFormatFromBlock(block: SerializedBlock): ValidatedInputFormatField[] {
  const metadata = block.metadata as { subBlocks?: Record<string, { value?: unknown }> } | undefined
  const subBlocksValue = metadata?.subBlocks?.inputFormat?.value
  const legacyValue = block.config?.params?.inputFormat
  const inputFormatValue = subBlocksValue ?? legacyValue

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
  userId?: string,
  triggerBlockId?: string,
  onFileResolved?: (file: UserFile) => void
): Promise<unknown> {
  if (!input || typeof input !== 'object' || blocks.length === 0) {
    return input
  }

  const startBlock = blocks.find((block) => {
    if (triggerBlockId) return block.id === triggerBlockId
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
  const fileFields = inputFormat.filter((field) => isFileFieldType(field.type))
  if (
    (startBlock.metadata?.id === TRIGGER_TYPES.START ||
      startBlock.metadata?.id === TRIGGER_TYPES.CHAT ||
      startBlock.metadata?.id === TRIGGER_TYPES.STARTER) &&
    isPlainRecord(input) &&
    Array.isArray(input.files) &&
    !fileFields.some((field) => field.name === 'files')
  )
    fileFields.push({ name: 'files', type: 'file[]' })

  if (fileFields.length === 0) {
    return input
  }

  const processedInput = { ...input } as Record<string, unknown>

  for (const fileField of fileFields) {
    const nestedInput = isPlainRecord(processedInput.input) ? processedInput.input : undefined
    const isNested = nestedInput !== undefined && Object.hasOwn(nestedInput, fileField.name)
    let fieldValue =
      (isNested ? nestedInput[fileField.name] : processedInput[fileField.name]) ?? fileField.value
    if (typeof fieldValue === 'string' && fieldValue.trim()) {
      try {
        fieldValue = JSON.parse(fieldValue)
      } catch {
        throw new Error(`Invalid file input for field: ${fileField.name}`)
      }
    }

    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
      const uploadedFiles = await processExecutionFiles(
        fieldValue,
        executionContext,
        requestId,
        userId
      )

      for (const file of uploadedFiles) onFileResolved?.(file)
      if (isNested) processedInput.input = { ...nestedInput, [fileField.name]: uploadedFiles }
      else processedInput[fileField.name] = uploadedFiles
      if (uploadedFiles.length > 0) {
        logger.info(
          `[${requestId}] Successfully processed ${uploadedFiles.length} file(s) for field: ${fileField.name}`
        )
      }
    }
  }

  return processedInput
}
