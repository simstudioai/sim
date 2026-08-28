import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { uploadDataverseFile } from '@/lib/internal/microsoft-dataverse/client'
import { DataverseOperationError } from '@/lib/internal/microsoft-dataverse/errors'
import type { DataverseUploadFileInput } from '@/lib/internal/microsoft-dataverse/schema'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { getDataverseBaseUrl } from '@/tools/microsoft_dataverse/utils'

const logger = createLogger('DataverseOperations')
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024

export interface DataverseOperationContext {
  requestId: string
  signal?: AbortSignal
  userId: string
}

async function deniedBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null)
  return isRecordLike(body) ? body : { success: false, error: 'File not found' }
}

function uploadTooLargeError(observedBytes: number): DataverseOperationError {
  const sizeMB = (observedBytes / (1024 * 1024)).toFixed(2)
  return new DataverseOperationError(
    `File size (${sizeMB}MB) exceeds Dataverse's 128MB limit for single-request file column uploads. Split the file and use chunked upload instead.`,
    400
  )
}

export async function executeDataverseUploadFile(
  input: DataverseUploadFileInput,
  context: DataverseOperationContext
) {
  context.signal?.throwIfAborted()
  let buffer: Buffer
  if (input.file) {
    let userFile
    try {
      userFile = processSingleFileToUserFile(input.file, context.requestId, logger)
    } catch (error) {
      throw new DataverseOperationError(getErrorMessage(error, 'Failed to process file'), 400)
    }
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) {
      throw new DataverseOperationError('File not found', denied.status, await deniedBody(denied))
    }
    try {
      const downloaded = await downloadServableFileFromStorage(
        userFile,
        context.requestId,
        logger,
        { maxBytes: MAX_UPLOAD_BYTES, signal: context.signal }
      )
      buffer = downloaded.buffer
    } catch (error) {
      context.signal?.throwIfAborted()
      if (isDocNotReadyError(error)) throw new DataverseOperationError(docNotReadyMessage(), 409)
      if (isPayloadSizeLimitError(error)) {
        throw uploadTooLargeError(error.observedBytes ?? userFile.size)
      }
      throw new DataverseOperationError(getErrorMessage(error, 'Failed to download file'), 500)
    }
  } else if (input.fileContent) {
    buffer = Buffer.from(input.fileContent, 'base64')
  } else {
    throw new DataverseOperationError('Either file or fileContent must be provided', 400)
  }
  if (buffer.length > MAX_UPLOAD_BYTES) throw uploadTooLargeError(buffer.length)

  const baseUrl = getDataverseBaseUrl(input.environmentUrl)
  const uploadUrl = `${baseUrl}/api/data/v9.2/${input.entitySetName.trim()}(${input.recordId.trim()})/${input.fileColumn.trim()}`
  await uploadDataverseFile(
    { accessToken: input.accessToken, fileName: input.fileName, uploadUrl },
    buffer,
    context.signal
  )
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: {
      recordId: input.recordId,
      fileColumn: input.fileColumn,
      fileName: input.fileName,
      success: true,
    },
  }
}
