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
import { requiredQuickBooksString } from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

export const quickbooksVoidInvoiceTool: ToolConfig<
  QuickBooksVoidTransactionParams,
  QuickBooksVoidResponse
> = {
  id: 'quickbooks_void_invoice',
  name: 'QuickBooks Void Invoice',
  description: 'Void an invoice after explicit confirmation',
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
      description: 'Invoice ID to void',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current invoice sync token',
    },
    confirmVoid: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Explicit confirmation that the invoice should be voided',
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
      const url = buildQuickBooksEntityUrl(params, 'invoice')
      url.searchParams.set('operation', 'void')
      return url.toString()
    },
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      if (params.confirmVoid !== true) throw new Error('Confirm void before voiding the invoice')
      return {
        Id: requiredQuickBooksString(params.transactionId, 'transactionId'),
        SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
      }
    },
    retry: { enabled: false },
  },
  transformResponse: async (response) => {
    const result = await transformQuickBooksMutationResponse<QuickBooksSalesTransaction>(
      response,
      'Invoice'
    )
    return { success: true, output: { ...result.output, voided: true } }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Voided native QuickBooks Invoice',
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_VOID_OUTPUTS,
  },
}
