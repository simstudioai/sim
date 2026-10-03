import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { BrexReceiptClient, BrexReceiptError } from '@/lib/internal/brex/client'
import type { BrexMatchReceiptInput, BrexUploadReceiptInput } from '@/lib/internal/brex/schema'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('BrexReceiptOperations')
export const MAX_BREX_RECEIPT_BYTES = 50 * 1024 * 1024

export interface BrexReceiptOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

async function executeReceipt(
  input: BrexMatchReceiptInput | BrexUploadReceiptInput,
  context: BrexReceiptOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  const userFiles = processFilesToUserFiles([input.file], context.requestId, logger)
  const userFile = userFiles[0]
  if (!userFile) return failureResponse('Invalid file input', 400)

  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) return denied

  let fileBuffer: Buffer
  try {
    const resolved = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_BREX_RECEIPT_BYTES,
      signal: context.signal,
    })
    fileBuffer = resolved.buffer
  } catch (error) {
    context.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    if (isPayloadSizeLimitError(error)) {
      return failureResponse('Receipt file exceeds the 50 MB limit', 400)
    }
    logger.error('Failed to download Brex receipt file', {
      error: getErrorMessage(error),
      requestId: context.requestId,
    })
    return failureResponse(getErrorMessage(error, 'Unknown error'), 500)
  }

  const expenseId = 'expenseId' in input ? input.expenseId : undefined
  const receiptName = input.receiptName || userFile.name
  try {
    const client = new BrexReceiptClient(input.apiKey, context.signal)
    const target = await client.createUploadTarget(receiptName, expenseId)
    if (!target.uri || !target.id) {
      return failureResponse('Brex did not return an upload URL', 502)
    }
    await client.uploadReceipt(target.uri, fileBuffer)
    context.signal?.throwIfAborted()
    return Response.json({
      success: true,
      output: {
        receiptId: target.id,
        receiptName,
        expenseId: expenseId ?? null,
      },
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof BrexReceiptError) return failureResponse(error.message, error.status)
    logger.error('Unexpected Brex receipt error', {
      error: getErrorMessage(error),
      requestId: context.requestId,
    })
    return failureResponse(getErrorMessage(error, 'Unknown error'), 500)
  }
}

export function executeBrexMatchReceipt(
  input: BrexMatchReceiptInput,
  context: BrexReceiptOperationContext
): Promise<Response> {
  return executeReceipt(input, context)
}

export function executeBrexUploadReceipt(
  input: BrexUploadReceiptInput,
  context: BrexReceiptOperationContext
): Promise<Response> {
  return executeReceipt(input, context)
}
