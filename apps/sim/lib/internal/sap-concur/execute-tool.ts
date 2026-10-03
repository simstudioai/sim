import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { describeSapConcurFetchError } from '@/lib/internal/sap-concur/client'
import {
  executeSapConcurApiOperation,
  executeSapConcurUploadOperation,
  type SapConcurOperationContext,
  SapConcurOperationError,
  type SapConcurOperationResult,
} from '@/lib/internal/sap-concur/operations'
import {
  sapConcurApiInputSchema,
  sapConcurUploadInputSchema,
} from '@/lib/internal/sap-concur/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('SapConcurToolExecution')

export const SAP_CONCUR_TOOL_IDS = [
  'sap_concur_approve_expense_report',
  'sap_concur_associate_attendees',
  'sap_concur_create_cash_advance',
  'sap_concur_create_expected_expense',
  'sap_concur_create_expense_report',
  'sap_concur_create_list_item',
  'sap_concur_create_purchase_request',
  'sap_concur_create_quick_expense',
  'sap_concur_create_quick_expense_with_image',
  'sap_concur_create_report_comment',
  'sap_concur_create_travel_request',
  'sap_concur_create_user',
  'sap_concur_delete_expected_expense',
  'sap_concur_delete_expense',
  'sap_concur_delete_expense_report',
  'sap_concur_delete_list_item',
  'sap_concur_delete_travel_request',
  'sap_concur_delete_user',
  'sap_concur_get_allocation',
  'sap_concur_get_budget',
  'sap_concur_get_cash_advance',
  'sap_concur_get_expected_expense',
  'sap_concur_get_expense',
  'sap_concur_get_expense_report',
  'sap_concur_get_itemizations',
  'sap_concur_get_itinerary',
  'sap_concur_get_list',
  'sap_concur_get_list_item',
  'sap_concur_get_purchase_request',
  'sap_concur_get_receipt',
  'sap_concur_get_receipt_status',
  'sap_concur_get_request_cash_advance',
  'sap_concur_get_travel_profile',
  'sap_concur_get_travel_request',
  'sap_concur_get_user',
  'sap_concur_issue_cash_advance',
  'sap_concur_list_allocations',
  'sap_concur_list_attendee_associations',
  'sap_concur_list_budget_categories',
  'sap_concur_list_budgets',
  'sap_concur_list_exceptions',
  'sap_concur_list_expected_expenses',
  'sap_concur_list_expense_reports',
  'sap_concur_list_expenses',
  'sap_concur_list_itineraries',
  'sap_concur_list_list_items',
  'sap_concur_list_lists',
  'sap_concur_list_receipts',
  'sap_concur_list_report_comments',
  'sap_concur_list_reports_to_approve',
  'sap_concur_list_travel_profiles_summary',
  'sap_concur_list_travel_request_comments',
  'sap_concur_list_travel_requests',
  'sap_concur_list_users',
  'sap_concur_move_travel_request',
  'sap_concur_recall_expense_report',
  'sap_concur_remove_all_attendees',
  'sap_concur_search_locations',
  'sap_concur_search_users',
  'sap_concur_send_back_expense_report',
  'sap_concur_submit_expense_report',
  'sap_concur_update_allocation',
  'sap_concur_update_expected_expense',
  'sap_concur_update_expense',
  'sap_concur_update_expense_report',
  'sap_concur_update_list_item',
  'sap_concur_update_travel_request',
  'sap_concur_update_user',
  'sap_concur_upload_exchange_rates',
  'sap_concur_upload_receipt_image',
] as const

const SAP_CONCUR_TOOL_ID_SET = new Set<string>(SAP_CONCUR_TOOL_IDS)

const SAP_CONCUR_UPLOAD_TOOL_IDS = new Set([
  'sap_concur_upload_receipt_image',
  'sap_concur_create_quick_expense_with_image',
])

function validationResponse(error: z.ZodError): Response {
  return Response.json(
    {
      success: false,
      error: error.issues[0]?.message || 'Validation failed',
    },
    { status: 400 }
  )
}

function inputSizeResponse(input: unknown): Response | null {
  let serialized: string
  try {
    serialized = JSON.stringify(input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Validation failed' }, { status: 400 })
  }
  if (Buffer.byteLength(serialized, 'utf8') <= DEFAULT_MAX_JSON_BODY_BYTES) return null
  return Response.json(
    {
      success: false,
      error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
    },
    { status: 413 }
  )
}

function isSapConcurToolId(toolId: string): boolean {
  return SAP_CONCUR_TOOL_ID_SET.has(toolId)
}

async function dispatch(
  request: InternalToolOperationCall,
  context: SapConcurOperationContext
): Promise<SapConcurOperationResult | Response> {
  if (!isSapConcurToolId(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported SAP Concur tool: ${request.toolId}` },
      { status: 500 }
    )
  }

  if (SAP_CONCUR_UPLOAD_TOOL_IDS.has(request.toolId)) {
    if (!request.context.userId) {
      return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
    }
    const parsed = sapConcurUploadInputSchema.safeParse(request.input)
    if (!parsed.success) return validationResponse(parsed.error)
    return executeSapConcurUploadOperation(parsed.data, context)
  }

  const parsed = sapConcurApiInputSchema.safeParse(request.input)
  if (!parsed.success) return validationResponse(parsed.error)
  return executeSapConcurApiOperation(parsed.data, context)
}

export const executeSapConcurTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const tooLarge = inputSizeResponse(request.input)
  if (tooLarge) return tooLarge
  try {
    const result = await dispatch(request, {
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return result instanceof Response
      ? result
      : Response.json(result.body, { headers: result.headers })
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof SapConcurOperationError) {
      return Response.json(error.body, { status: error.status, headers: error.headers })
    }
    if (isPayloadSizeLimitError(error)) {
      return Response.json({ success: false, error: error.message }, { status: 413 })
    }
    const message = describeSapConcurFetchError(error)
    logger.error('SAP Concur operation failed', {
      error: getErrorMessage(error),
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
