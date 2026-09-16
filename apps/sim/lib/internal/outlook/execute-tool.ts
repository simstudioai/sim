import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  outlookCopyContract,
  outlookDeleteContract,
  outlookDraftContract,
  outlookMarkReadContract,
  outlookMarkUnreadContract,
  outlookMoveContract,
  outlookSendContract,
} from '@/lib/api/contracts/tools/microsoft'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { OutlookOperationError } from '@/lib/internal/outlook/errors'
import { outlookGetAttachmentInputSchema } from '@/lib/internal/outlook/get-attachment-input'
import {
  executeOutlookCopy,
  executeOutlookDelete,
  executeOutlookDraft,
  executeOutlookGetAttachment,
  executeOutlookMarkRead,
  executeOutlookMarkUnread,
  executeOutlookMove,
  executeOutlookSend,
  type OutlookMailOperationContext,
} from '@/lib/internal/outlook/operations'
import { isInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import { parseInternalOperationInput } from '@/lib/internal/tool-operations/parse-contract-input'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type {
  InternalToolOperationHandler,
  InternalToolOperationResult,
} from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>) => Promise<unknown>,
  signal?: AbortSignal
): Promise<InternalToolOperationResult> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input, {
    maxInputBytes: DEFAULT_MAX_JSON_BODY_BYTES,
  })
  if (!parsed.success) return parsed.response
  return executeAndPresent(() => execute(parsed.data), signal)
}

async function executeAndPresent(
  execute: () => Promise<unknown>,
  signal?: AbortSignal
): Promise<InternalToolOperationResult> {
  try {
    const result = await execute()
    signal?.throwIfAborted()
    return isInternalToolFileResult(result) ? result : Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OutlookOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status: 500 }
    )
  }
}

export const executeOutlookTool: InternalToolOperationHandler<InternalToolOperationResult> = async (
  request
) => {
  const { input, context, requestId, signal, toolId } = request
  signal?.throwIfAborted()
  const mailContext: OutlookMailOperationContext = {
    requestId,
    signal,
    userId: context.userId,
  }
  switch (toolId) {
    case 'outlook_get_attachment': {
      const parsed = parseInternalOperationInput({ body: outlookGetAttachmentInputSchema }, input, {
        maxInputBytes: DEFAULT_MAX_JSON_BODY_BYTES,
      })
      if (!parsed.success) return parsed.response
      return executeAndPresent(() => executeOutlookGetAttachment(parsed.data.body, signal), signal)
    }
    case 'outlook_copy':
      return executeOperation(
        outlookCopyContract,
        input,
        (input) => executeOutlookCopy(input, signal),
        signal
      )
    case 'outlook_delete':
      return executeOperation(
        outlookDeleteContract,
        input,
        (input) => executeOutlookDelete(input, signal),
        signal
      )
    case 'outlook_draft':
      return executeOperation(
        outlookDraftContract,
        input,
        (input) => executeOutlookDraft(input, mailContext),
        signal
      )
    case 'outlook_mark_read':
      return executeOperation(
        outlookMarkReadContract,
        input,
        (input) => executeOutlookMarkRead(input, signal),
        signal
      )
    case 'outlook_mark_unread':
      return executeOperation(
        outlookMarkUnreadContract,
        input,
        (input) => executeOutlookMarkUnread(input, signal),
        signal
      )
    case 'outlook_move':
      return executeOperation(
        outlookMoveContract,
        input,
        (input) => executeOutlookMove(input, signal),
        signal
      )
    case 'outlook_send':
      return executeOperation(
        outlookSendContract,
        input,
        (input) => executeOutlookSend(input, mailContext),
        signal
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported Outlook tool: ${toolId}` },
        { status: 500 }
      )
  }
}
