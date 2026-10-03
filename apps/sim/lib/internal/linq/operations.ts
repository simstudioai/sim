import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { registerLinqAttachment, uploadLinqAttachmentBytes } from '@/lib/internal/linq/client'
import { LinqOperationError } from '@/lib/internal/linq/errors'
import type { LinqCreateAttachmentInput } from '@/lib/internal/linq/schema'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('LinqOperations')
const MAX_SIZE_BYTES = 100 * 1024 * 1024

export interface LinqOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId: string
}

async function deniedBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null)
  return isRecordLike(body) ? body : { success: false, error: 'File not found' }
}

function fileTooLargeError(sizeBytes: number): LinqOperationError {
  return new LinqOperationError(
    `File exceeds Linq's 100MB attachment limit (${(sizeBytes / (1024 * 1024)).toFixed(2)}MB)`,
    400
  )
}

function validateProvenance(input: LinqCreateAttachmentInput, context: LinqOperationContext): void {
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) {
    throw new LinqOperationError(provenance.error, provenance.status)
  }
}

export async function executeLinqCreateAttachment(
  input: LinqCreateAttachmentInput,
  context: LinqOperationContext
) {
  context.signal?.throwIfAborted()
  validateProvenance(input, context)
  let buffer: Buffer
  let filename = input.filename ?? ''
  let contentType = input.contentType ?? ''

  if (input.file) {
    const userFile = processFilesToUserFiles(
      [input.file as RawFileInput],
      context.requestId,
      logger
    )[0]
    if (!userFile) throw new LinqOperationError('No valid file provided', 400)
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied)
      throw new LinqOperationError('File not found', denied.status, await deniedBody(denied))
    if (!(await isModelSafeWorkspaceFileKey(userFile.key))) {
      throw new LinqOperationError(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE, 400)
    }
    context.signal?.throwIfAborted()
    try {
      const downloaded = await downloadServableFileFromStorage(
        userFile,
        context.requestId,
        logger,
        { maxBytes: MAX_SIZE_BYTES, signal: context.signal }
      )
      buffer = downloaded.buffer
      if (!filename) filename = userFile.name
      if (!contentType) {
        contentType = downloaded.contentType || userFile.type || 'application/octet-stream'
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (isDocNotReadyError(error)) throw new LinqOperationError(docNotReadyMessage(), 409)
      if (isPayloadSizeLimitError(error)) {
        throw fileTooLargeError(error.observedBytes ?? userFile.size)
      }
      throw new LinqOperationError(getErrorMessage(error, 'Unknown error occurred'), 500)
    }
  } else if (input.fileContent) {
    buffer = Buffer.from(input.fileContent, 'base64')
    if (!filename) filename = 'file'
    if (!contentType) contentType = 'application/octet-stream'
  } else {
    throw new LinqOperationError('A file is required to upload an attachment', 400)
  }

  if (buffer.length === 0) throw new LinqOperationError('File is empty', 400)
  if (buffer.length > MAX_SIZE_BYTES) throw fileTooLargeError(buffer.length)
  const registration = await registerLinqAttachment(
    {
      apiKey: input.apiKey,
      contentType,
      filename,
      sizeBytes: buffer.length,
    },
    context.signal
  )
  await uploadLinqAttachmentBytes(registration, buffer, context.signal)
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: {
      attachmentId: registration.attachmentId,
      downloadUrl: registration.downloadUrl,
      filename,
      contentType,
      sizeBytes: buffer.length,
      status: 'complete',
    },
  }
}
