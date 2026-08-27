import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  gmailAddLabelContract,
  gmailArchiveContract,
  gmailDeleteContract,
  gmailDraftContract,
  gmailEditDraftContract,
  gmailMarkReadContract,
  gmailMarkUnreadContract,
  gmailMoveContract,
  gmailRemoveLabelContract,
  gmailSendContract,
  gmailUnarchiveContract,
} from '@/lib/api/contracts/tools/google'
import { GmailOperationError } from '@/lib/internal/gmail/errors'
import {
  executeGmailDraft,
  executeGmailEditDraft,
  executeGmailSend,
  type GmailMailOperationContext,
} from '@/lib/internal/gmail/mail'
import {
  executeGmailAddLabel,
  executeGmailArchive,
  executeGmailDelete,
  executeGmailMarkRead,
  executeGmailMarkUnread,
  executeGmailMove,
  executeGmailRemoveLabel,
  executeGmailUnarchive,
} from '@/lib/internal/gmail/messages'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>) => Promise<unknown>,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response
  try {
    const result = await execute(parsed.data)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof GmailOperationError) {
      return Response.json(error.body ?? { success: false, error: error.message }, {
        status: error.status,
      })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
}

export const executeGmailTool: InternalToolOperationHandler = async (request) => {
  const { input, context, requestId, signal, toolId } = request
  const mailContext: GmailMailOperationContext = {
    requestId,
    signal,
    userId: context.userId,
  }
  switch (toolId) {
    case 'gmail_add_label':
    case 'gmail_add_label_v2':
      return executeOperation(
        gmailAddLabelContract,
        input,
        (input) => executeGmailAddLabel(input, signal),
        signal
      )
    case 'gmail_archive':
    case 'gmail_archive_v2':
      return executeOperation(
        gmailArchiveContract,
        input,
        (input) => executeGmailArchive(input, signal),
        signal
      )
    case 'gmail_delete':
    case 'gmail_delete_v2':
      return executeOperation(
        gmailDeleteContract,
        input,
        (input) => executeGmailDelete(input, signal),
        signal
      )
    case 'gmail_draft':
    case 'gmail_draft_v2':
      return executeOperation(
        gmailDraftContract,
        input,
        (input) => executeGmailDraft(input, mailContext),
        signal
      )
    case 'gmail_edit_draft_v2':
      return executeOperation(
        gmailEditDraftContract,
        input,
        (input) => executeGmailEditDraft(input, mailContext),
        signal
      )
    case 'gmail_mark_read':
    case 'gmail_mark_read_v2':
      return executeOperation(
        gmailMarkReadContract,
        input,
        (input) => executeGmailMarkRead(input, signal),
        signal
      )
    case 'gmail_mark_unread':
    case 'gmail_mark_unread_v2':
      return executeOperation(
        gmailMarkUnreadContract,
        input,
        (input) => executeGmailMarkUnread(input, signal),
        signal
      )
    case 'gmail_move':
    case 'gmail_move_v2':
      return executeOperation(
        gmailMoveContract,
        input,
        (input) => executeGmailMove(input, signal),
        signal
      )
    case 'gmail_remove_label':
    case 'gmail_remove_label_v2':
      return executeOperation(
        gmailRemoveLabelContract,
        input,
        (input) => executeGmailRemoveLabel(input, signal),
        signal
      )
    case 'gmail_send':
    case 'gmail_send_v2':
      return executeOperation(
        gmailSendContract,
        input,
        (input) => executeGmailSend(input, mailContext),
        signal
      )
    case 'gmail_unarchive':
    case 'gmail_unarchive_v2':
      return executeOperation(
        gmailUnarchiveContract,
        input,
        (input) => executeGmailUnarchive(input, signal),
        signal
      )
    default:
      return Response.json(
        { success: false, error: `Unsupported Gmail tool: ${toolId}` },
        { status: 500 }
      )
  }
}
