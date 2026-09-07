import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksPurchasingTransaction,
  QuickBooksVoidResponse,
  QuickBooksVoidTransactionParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
  QUICKBOOKS_VOID_OUTPUTS,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import { assertQuickBooksSparseUpdate, requiredQuickBooksString } from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

/**
 * Intuit: "Use a sparse update operation with `include=void` to void an existing
 * BillPayment object; include a minimum of BillPayment.Id and
 * BillPayment.SyncToken. The transaction remains active but all amounts and
 * quantities are zeroed, all lines are cleared, and the string, Voided, is
 * injected into BillPayment.PrivateNote, prepended to existing text if present."
 */
export const quickbooksVoidBillPaymentTool: ToolConfig<
  QuickBooksVoidTransactionParams,
  QuickBooksVoidResponse
> = {
  id: 'quickbooks_void_bill_payment',
  name: 'QuickBooks Void Bill Payment',
  description: 'Void a bill payment after explicit confirmation',
  version: '1.0.0',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID derived from the connected credential',
    },
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
    },
    transactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'BillPayment ID to void',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current BillPayment sync token',
    },
    confirmVoid: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Explicit confirmation that the bill payment should be voided',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      const url = buildQuickBooksEntityUrl(params, 'billpayment')
      url.searchParams.set('operation', 'update')
      url.searchParams.set('include', 'void')
      return url.toString()
    },
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      if (params.confirmVoid !== true) {
        throw new Error('Confirm void before voiding the bill payment')
      }
      const body = {
        Id: requiredQuickBooksString(params.transactionId, 'transactionId'),
        SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
        sparse: true,
      }
      assertQuickBooksSparseUpdate(body, 2)
      return body
    },
    retry: { enabled: false },
  },
  transformResponse: async (response) => {
    const result = await transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(
      response,
      'BillPayment'
    )
    return { success: true, output: { ...result.output, voided: true } }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Voided native QuickBooks BillPayment',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_VOID_OUTPUTS,
  },
}
