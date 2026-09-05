import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  quickBooksAddAttachmentBodySchema,
  quickBooksDownloadDocumentBodySchema,
} from '@/lib/api/contracts/tools/quickbooks'
import { getValidationErrorMessage } from '@/lib/api/server'
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
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
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

export const executeQuickBooksTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  switch (request.toolId) {
    case 'quickbooks_create_bill_payment':
      return executeToolOperationImplementation(
        executeQuickBooksCreateBillPaymentOperation,
        request
      )
    case 'quickbooks_update_bill':
      return executeToolOperationImplementation(executeQuickBooksUpdateBillOperation, request)
    case 'quickbooks_update_bill_payment':
      return executeToolOperationImplementation(
        executeQuickBooksUpdateBillPaymentOperation,
        request
      )
    case 'quickbooks_update_credit_memo':
      return executeToolOperationImplementation(executeQuickBooksUpdateCreditMemoOperation, request)
    case 'quickbooks_update_customer_payment':
      return executeToolOperationImplementation(
        executeQuickBooksUpdateCustomerPaymentOperation,
        request
      )
    case 'quickbooks_update_employee':
      return executeToolOperationImplementation(executeQuickBooksUpdateEmployeeOperation, request)
    case 'quickbooks_update_item':
      return executeToolOperationImplementation(executeQuickBooksUpdateItemOperation, request)
    case 'quickbooks_update_purchase':
      return executeToolOperationImplementation(executeQuickBooksUpdatePurchaseOperation, request)
    case 'quickbooks_update_purchase_order':
      return executeToolOperationImplementation(
        executeQuickBooksUpdatePurchaseOrderOperation,
        request
      )
    case 'quickbooks_update_refund_receipt':
      return executeToolOperationImplementation(
        executeQuickBooksUpdateRefundReceiptOperation,
        request
      )
    case 'quickbooks_update_vendor':
      return executeToolOperationImplementation(executeQuickBooksUpdateVendorOperation, request)
    case 'quickbooks_update_vendor_credit':
      return executeToolOperationImplementation(
        executeQuickBooksUpdateVendorCreditOperation,
        request
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

  const sizeError = inputSizeError(request.input)
  if (sizeError) return sizeError
  const context = operationContext(request)
  if (!context) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  try {
    if (request.toolId === 'quickbooks_add_attachment') {
      const parsed = quickBooksAddAttachmentBodySchema.safeParse(request.input)
      if (!parsed.success) {
        return Response.json(
          {
            success: false,
            error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
          },
          { status: 400 }
        )
      }
      return Response.json({
        success: true,
        output: await executeQuickBooksAddAttachment(parsed.data, context),
      })
    }

    const documentInput = {
      ...(request.input as Record<string, unknown>),
      documentKind:
        request.toolId === 'quickbooks_download_attachment' ? 'attachment' : 'transaction_pdf',
    }
    const parsed = quickBooksDownloadDocumentBodySchema.safeParse(documentInput)
    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
        },
        { status: 400 }
      )
    }
    return Response.json({
      success: true,
      output: await executeQuickBooksDownloadDocument(parsed.data, context),
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
