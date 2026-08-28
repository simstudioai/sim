import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import {
  agiloftAsyncStatusContract,
  agiloftAttachContract,
  agiloftAttachmentInfoContract,
  agiloftCreateRecordContract,
  agiloftDeleteRecordContract,
  agiloftGetChoiceLineIdContract,
  agiloftListTablesContract,
  agiloftLockRecordContract,
  agiloftNlpSearchContract,
  agiloftReadRecordContract,
  agiloftRemoveAttachmentContract,
  agiloftRetrieveContract,
  agiloftRunActionButtonContract,
  agiloftSavedSearchContract,
  agiloftSearchRecordsContract,
  agiloftSelectRecordsContract,
  agiloftUpdateRecordContract,
  agiloftUpsertRecordContract,
} from '@/lib/api/contracts/tools/agiloft'
import { AgiloftOperationError } from '@/lib/internal/agiloft/errors'
import {
  type AgiloftOperationContext,
  executeAgiloftAsyncStatus,
  executeAgiloftAttachFile,
  executeAgiloftAttachmentInfo,
  executeAgiloftCreateRecord,
  executeAgiloftDeleteRecord,
  executeAgiloftGetChoiceLineId,
  executeAgiloftListTables,
  executeAgiloftLockRecord,
  executeAgiloftNlpSearch,
  executeAgiloftReadRecord,
  executeAgiloftRemoveAttachment,
  executeAgiloftRetrieveAttachment,
  executeAgiloftRunActionButton,
  executeAgiloftSavedSearch,
  executeAgiloftSearchRecords,
  executeAgiloftSelectRecords,
  executeAgiloftUpdateRecord,
  executeAgiloftUpsertRecord,
} from '@/lib/internal/agiloft/operations'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

function parseInput<C extends AnyApiRouteContract>(contract: C, input: unknown) {
  const parsed = contract.body?.safeParse(input)
  if (!parsed?.success) {
    return {
      success: false as const,
      response: Response.json(
        {
          success: false,
          error: parsed?.error.issues[0]?.message || 'Invalid request data',
          details: parsed?.error.issues ?? [],
        },
        { status: 400 }
      ),
    }
  }
  return { success: true as const, data: parsed.data as ContractBody<C> }
}

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  request: InternalToolOperationCall,
  operation: (input: ContractBody<C>, context: AgiloftOperationContext) => Promise<unknown>
): Promise<Response> {
  request.signal?.throwIfAborted()
  const parsed = parseInput(contract, request.input)
  if (!parsed.success) return parsed.response
  try {
    const result = await operation(parsed.data, {
      requestId: request.requestId,
      userId: request.context.executorDelegationOrigin?.subjectUserId ?? request.context.userId,
      signal: request.signal,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof AgiloftOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Agiloft request failed') },
      { status: 500 }
    )
  }
}

export const executeAgiloftTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'agiloft_async_status':
      return executeOperation(agiloftAsyncStatusContract, request, executeAgiloftAsyncStatus)
    case 'agiloft_attach_file':
      return executeOperation(agiloftAttachContract, request, executeAgiloftAttachFile)
    case 'agiloft_attachment_info':
      return executeOperation(agiloftAttachmentInfoContract, request, executeAgiloftAttachmentInfo)
    case 'agiloft_create_record':
      return executeOperation(agiloftCreateRecordContract, request, executeAgiloftCreateRecord)
    case 'agiloft_delete_record':
      return executeOperation(agiloftDeleteRecordContract, request, executeAgiloftDeleteRecord)
    case 'agiloft_get_choice_line_id':
      return executeOperation(
        agiloftGetChoiceLineIdContract,
        request,
        executeAgiloftGetChoiceLineId
      )
    case 'agiloft_list_tables':
      return executeOperation(agiloftListTablesContract, request, executeAgiloftListTables)
    case 'agiloft_lock_record':
      return executeOperation(agiloftLockRecordContract, request, executeAgiloftLockRecord)
    case 'agiloft_nlp_search':
      return executeOperation(agiloftNlpSearchContract, request, executeAgiloftNlpSearch)
    case 'agiloft_read_record':
      return executeOperation(agiloftReadRecordContract, request, executeAgiloftReadRecord)
    case 'agiloft_remove_attachment':
      return executeOperation(
        agiloftRemoveAttachmentContract,
        request,
        executeAgiloftRemoveAttachment
      )
    case 'agiloft_retrieve_attachment':
      return executeOperation(agiloftRetrieveContract, request, executeAgiloftRetrieveAttachment)
    case 'agiloft_run_action_button':
      return executeOperation(
        agiloftRunActionButtonContract,
        request,
        executeAgiloftRunActionButton
      )
    case 'agiloft_saved_search':
      return executeOperation(agiloftSavedSearchContract, request, executeAgiloftSavedSearch)
    case 'agiloft_search_records':
      return executeOperation(agiloftSearchRecordsContract, request, executeAgiloftSearchRecords)
    case 'agiloft_select_records':
      return executeOperation(agiloftSelectRecordsContract, request, executeAgiloftSelectRecords)
    case 'agiloft_update_record':
      return executeOperation(agiloftUpdateRecordContract, request, executeAgiloftUpdateRecord)
    case 'agiloft_upsert_record':
      return executeOperation(agiloftUpsertRecordContract, request, executeAgiloftUpsertRecord)
    default:
      return Response.json(
        { error: `Unsupported Agiloft tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
