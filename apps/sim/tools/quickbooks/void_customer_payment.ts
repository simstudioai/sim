import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
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
  requiredQuickBooksString,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksVoidCustomerPaymentTool: ToolConfig<
  QuickBooksVoidTransactionParams,
  QuickBooksVoidResponse
> = {
  id: 'quickbooks_void_customer_payment',
  name: 'QuickBooks Void Customer Payment',
  description: 'Void a customer payment after explicit confirmation',
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
    transactionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payment ID to void',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current payment sync token',
    },
    confirmVoid: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Explicit confirmation that the payment should be voided',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      const url = buildQuickBooksEntityUrl(params.realmId, 'payment')
      url.searchParams.set('operation', 'update')
      url.searchParams.set('include', 'void')
      return url.toString()
    },
    method: 'POST',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken, 'application/json'),
    body: (params) => {
      if (params.confirmVoid !== true) throw new Error('Confirm void before voiding the payment')
      return {
        Id: requiredQuickBooksString(params.transactionId, 'transactionId'),
        SyncToken: requiredQuickBooksString(params.syncToken, 'syncToken'),
        sparse: true,
      }
    },
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: async (response) => {
    const result = await transformQuickBooksMutationResponse<QuickBooksSalesTransaction>(
      response,
      'Payment'
    )
    return { success: true, output: { ...result.output, voided: true } }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Voided native QuickBooks Payment',
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_VOID_OUTPUTS,
  },
}
