import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksSalesTransaction,
  QuickBooksVoidResponse,
  QuickBooksVoidTransactionParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
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
 * Intuit: "Use a sparse update operation with `include=void` to void an
 * existing SalesReceipt object; include a minimum of `SalesReceipt.Id` and
 * `SalesReceipt.SyncToken`." The documented request model for that operation is
 * `voidrequest`, whose required set is `id`, `SyncToken`, and `sparse` — the
 * same shape Payment's void takes, and unlike Invoice, which voids through
 * `?operation=void` with no `sparse`.
 */
export const quickbooksVoidSalesReceiptTool: ToolConfig<
  QuickBooksVoidTransactionParams,
  QuickBooksVoidResponse
> = {
  id: 'quickbooks_void_sales_receipt',
  name: 'QuickBooks Void Sales Receipt',
  description: 'Void a sales receipt after explicit confirmation',
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
      description: 'Sales receipt ID to void',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current sales receipt sync token',
    },
    confirmVoid: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Explicit confirmation that the sales receipt should be voided',
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
      const url = buildQuickBooksEntityUrl(params, 'salesreceipt')
      url.searchParams.set('operation', 'update')
      url.searchParams.set('include', 'void')
      return url.toString()
    },
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      if (params.confirmVoid !== true) {
        throw new Error('Confirm void before voiding the sales receipt')
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
    const result = await transformQuickBooksMutationResponse<QuickBooksSalesTransaction>(
      response,
      'SalesReceipt'
    )
    return { success: true, output: { ...result.output, voided: true } }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Voided native QuickBooks SalesReceipt',
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_VOID_OUTPUTS,
  },
}
