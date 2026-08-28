import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { uploadServiceNowAttachment } from '@/lib/internal/servicenow/client'
import { ServiceNowOperationError } from '@/lib/internal/servicenow/errors'
import type { ServiceNowUploadAttachmentInput } from '@/lib/internal/servicenow/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('ServiceNowOperations')

export interface ServiceNowOperationContext {
  requestId: string
  signal?: AbortSignal
  userId: string
}

async function deniedBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null)
  return isRecordLike(body) ? body : { success: false, error: 'File not found' }
}

export async function executeServiceNowUploadAttachment(
  input: ServiceNowUploadAttachmentInput,
  context: ServiceNowOperationContext
) {
  context.signal?.throwIfAborted()
  if (!input.file) throw new ServiceNowOperationError('A file is required', 400)
  let userFile
  try {
    userFile = processSingleFileToUserFile(input.file, context.requestId, logger)
  } catch (error) {
    throw new ServiceNowOperationError(getErrorMessage(error, 'Failed to process file'), 400)
  }
  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) {
    throw new ServiceNowOperationError('File not found', denied.status, await deniedBody(denied))
  }

  let buffer: Buffer
  let resolvedContentType: string
  try {
    const downloaded = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      signal: context.signal,
    })
    buffer = downloaded.buffer
    resolvedContentType = downloaded.contentType
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isDocNotReadyError(error)) throw new ServiceNowOperationError(docNotReadyMessage(), 409)
    throw new ServiceNowOperationError(
      getErrorMessage(error, 'Failed to download file'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
  const result = await uploadServiceNowAttachment(
    {
      contentType: resolvedContentType || userFile.type || 'application/octet-stream',
      fileName: input.fileName,
      instanceUrl: input.instanceUrl,
      password: input.password,
      recordSysId: input.recordSysId,
      tableName: input.tableName,
      username: input.username,
    },
    buffer,
    context.signal
  )
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: {
      attachment: result
        ? {
            sys_id: result.sys_id ?? null,
            file_name: result.file_name ?? null,
            content_type: result.content_type ?? null,
            size_bytes: result.size_bytes ?? null,
            table_name: result.table_name ?? null,
            table_sys_id: result.table_sys_id ?? null,
            download_link: result.download_link ?? null,
          }
        : null,
      metadata: { recordCount: 1 },
    },
  }
}
