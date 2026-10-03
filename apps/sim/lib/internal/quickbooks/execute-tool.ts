import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  quickBooksAddAttachmentContract,
  quickBooksCreateBillPaymentContract,
  quickBooksDownloadDocumentContract,
  quickBooksUpdateBillContract,
  quickBooksUpdateBillPaymentContract,
  quickBooksUpdateCreditMemoContract,
  quickBooksUpdateCustomerPaymentContract,
  quickBooksUpdateEmployeeContract,
  quickBooksUpdateItemContract,
  quickBooksUpdatePurchaseContract,
  quickBooksUpdatePurchaseOrderContract,
  quickBooksUpdateRefundReceiptContract,
  quickBooksUpdateVendorContract,
  quickBooksUpdateVendorCreditContract,
} from '@/lib/api/contracts/tools/quickbooks'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  executeQuickBooksAddAttachment,
  executeQuickBooksDownloadDocument,
  QuickBooksInternalOperationError,
  type QuickBooksOperationContext,
} from '@/lib/internal/quickbooks/operations'
import {
  executeQuickBooksCreateBillPaymentOperation,
  executeQuickBooksUpdateBillOperation,
  executeQuickBooksUpdateBillPaymentOperation,
  executeQuickBooksUpdateCreditMemoOperation,
  executeQuickBooksUpdateCustomerPaymentOperation,
  executeQuickBooksUpdateEmployeeOperation,
  executeQuickBooksUpdateItemOperation,
  executeQuickBooksUpdatePurchaseOperation,
  executeQuickBooksUpdatePurchaseOrderOperation,
  executeQuickBooksUpdateRefundReceiptOperation,
  executeQuickBooksUpdateVendorCreditOperation,
  executeQuickBooksUpdateVendorOperation,
} from '@/lib/internal/quickbooks/provider-operations'
import { executeInternalJsonToolOperation } from '@/lib/internal/tool-operations/execute-json-operation'
import { parseInternalContractInput } from '@/lib/internal/tool-operations/parse-contract-input'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('QuickBooksToolExecution')
const QUICKBOOKS_MAX_OPERATION_INPUT_BYTES = 1024 * 1024
const QUICKBOOKS_FILE_TOOL_IDS = [
  'quickbooks_add_attachment',
  'quickbooks_download_attachment',
  'quickbooks_download_transaction_pdf',
] as const

type QuickBooksFileToolId = (typeof QUICKBOOKS_FILE_TOOL_IDS)[number]

function isQuickBooksFileToolId(value: string): value is QuickBooksFileToolId {
  return QUICKBOOKS_FILE_TOOL_IDS.some((toolId) => toolId === value)
}

function inputSizeError(input: unknown): Response | null {
  let serialized: string
  try {
    serialized = JSON.stringify(input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serialized, 'utf8') <= QUICKBOOKS_MAX_OPERATION_INPUT_BYTES) return null
  return Response.json(
    {
      success: false,
      error: `Request body exceeds the maximum allowed size of ${QUICKBOOKS_MAX_OPERATION_INPUT_BYTES} bytes`,
    },
    { status: 413 }
  )
}

function operationContext(request: InternalToolOperationCall): QuickBooksOperationContext | null {
  const userId = request.context.userId
  if (!userId) return null
  return {
    userId,
    requestId: request.requestId,
    workspaceId: request.context.workspaceId,
    workflowId: request.context.workflowId,
    executionId: request.context.executionId,
    signal: request.signal ?? new AbortController().signal,
  }
}

/**
 * Every QuickBooks tool id passes the same admission gates — cancellation, the
 * operation input cap, and the trusted execution identity — before any provider
 * work is dispatched.
 */
export const executeQuickBooksTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()

  const sizeError = inputSizeError(request.input)
  if (sizeError) return sizeError

  const context = operationContext(request)
  if (!context) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  switch (request.toolId) {
    case 'quickbooks_create_bill_payment':
      return executeInternalJsonToolOperation(
        quickBooksCreateBillPaymentContract,
        request.input,
        executeQuickBooksCreateBillPaymentOperation,
        'Failed to create QuickBooks bill payment',
        request.signal
      )
    case 'quickbooks_update_bill':
      return executeInternalJsonToolOperation(
        quickBooksUpdateBillContract,
        request.input,
        executeQuickBooksUpdateBillOperation,
        'Failed to update QuickBooks bill',
        request.signal
      )
    case 'quickbooks_update_bill_payment':
      return executeInternalJsonToolOperation(
        quickBooksUpdateBillPaymentContract,
        request.input,
        executeQuickBooksUpdateBillPaymentOperation,
        'Failed to update QuickBooks bill payment',
        request.signal
      )
    case 'quickbooks_update_credit_memo':
      return executeInternalJsonToolOperation(
        quickBooksUpdateCreditMemoContract,
        request.input,
        executeQuickBooksUpdateCreditMemoOperation,
        'Failed to update QuickBooks credit memo',
        request.signal
      )
    case 'quickbooks_update_customer_payment':
      return executeInternalJsonToolOperation(
        quickBooksUpdateCustomerPaymentContract,
        request.input,
        executeQuickBooksUpdateCustomerPaymentOperation,
        'Failed to update QuickBooks customer payment',
        request.signal
      )
    case 'quickbooks_update_employee':
      return executeInternalJsonToolOperation(
        quickBooksUpdateEmployeeContract,
        request.input,
        executeQuickBooksUpdateEmployeeOperation,
        'Failed to update QuickBooks employee',
        request.signal
      )
    case 'quickbooks_update_item':
      return executeInternalJsonToolOperation(
        quickBooksUpdateItemContract,
        request.input,
        executeQuickBooksUpdateItemOperation,
        'Failed to update QuickBooks item',
        request.signal
      )
    case 'quickbooks_update_purchase':
      return executeInternalJsonToolOperation(
        quickBooksUpdatePurchaseContract,
        request.input,
        executeQuickBooksUpdatePurchaseOperation,
        'Failed to update QuickBooks purchase',
        request.signal
      )
    case 'quickbooks_update_purchase_order':
      return executeInternalJsonToolOperation(
        quickBooksUpdatePurchaseOrderContract,
        request.input,
        executeQuickBooksUpdatePurchaseOrderOperation,
        'Failed to update QuickBooks purchase order',
        request.signal
      )
    case 'quickbooks_update_refund_receipt':
      return executeInternalJsonToolOperation(
        quickBooksUpdateRefundReceiptContract,
        request.input,
        executeQuickBooksUpdateRefundReceiptOperation,
        'Failed to update QuickBooks refund receipt',
        request.signal
      )
    case 'quickbooks_update_vendor':
      return executeInternalJsonToolOperation(
        quickBooksUpdateVendorContract,
        request.input,
        executeQuickBooksUpdateVendorOperation,
        'Failed to update QuickBooks vendor',
        request.signal
      )
    case 'quickbooks_update_vendor_credit':
      return executeInternalJsonToolOperation(
        quickBooksUpdateVendorCreditContract,
        request.input,
        executeQuickBooksUpdateVendorCreditOperation,
        'Failed to update QuickBooks vendor credit',
        request.signal
      )
  }

  if (!isQuickBooksFileToolId(request.toolId)) {
    return Response.json(
      {
        success: false,
        error: `Unsupported QuickBooks tool: ${request.toolId}`,
      },
      { status: 500 }
    )
  }

  try {
    if (request.toolId === 'quickbooks_add_attachment') {
      const parsed = parseInternalContractInput(quickBooksAddAttachmentContract, request.input)
      if (!parsed.success) return parsed.response
      return Response.json({
        success: true,
        output: await executeQuickBooksAddAttachment(parsed.data.body, context),
      })
    }

    const documentInput = {
      ...(request.input as Record<string, unknown>),
      documentKind:
        request.toolId === 'quickbooks_download_attachment' ? 'attachment' : 'transaction_pdf',
    }
    const parsed = parseInternalContractInput(quickBooksDownloadDocumentContract, documentInput)
    if (!parsed.success) return parsed.response
    return Response.json({
      success: true,
      output: await executeQuickBooksDownloadDocument(parsed.data.body, context),
    })
  } catch (error) {
    request.signal?.throwIfAborted()
    const status =
      error instanceof QuickBooksInternalOperationError
        ? error.status
        : isPayloadSizeLimitError(error)
          ? 413
          : 500
    const message = getErrorMessage(error, 'QuickBooks file operation failed')
    logger.error('QuickBooks file operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status })
  }
}
