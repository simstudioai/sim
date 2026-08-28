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
import {
  executeOutlookCopy,
  executeOutlookDelete,
  executeOutlookDraft,
  executeOutlookMarkRead,
  executeOutlookMarkUnread,
  executeOutlookMove,
  executeOutlookSend,
  type OutlookMailOperationContext,
} from '@/lib/internal/outlook/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>) => Promise<unknown>,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input, {
    maxInputBytes: DEFAULT_MAX_JSON_BODY_BYTES,
  })
  if (!parsed.success) return parsed.response
  try {
    const result = await execute(parsed.data)
    signal?.throwIfAborted()
    return Response.json(result)
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

export const executeOutlookTool: InternalToolOperationHandler = async (request) => {
  const { input, context, requestId, signal, toolId } = request
  const mailContext: OutlookMailOperationContext = {
    requestId,
    signal,
    userId: context.userId,
  }
  switch (toolId) {
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
