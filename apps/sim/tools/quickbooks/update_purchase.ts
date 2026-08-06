import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksUpdatePurchaseBody } from '@/tools/quickbooks/purchasing_utils'
import type {
  QuickBooksMutationResponse,
  QuickBooksPurchasingTransaction,
  QuickBooksUpdatePurchaseParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksUpdatePurchaseTool: ToolConfig<
  QuickBooksUpdatePurchaseParams,
  QuickBooksMutationResponse<QuickBooksPurchasingTransaction>
> = {
  id: 'quickbooks_update_purchase',
  name: 'QuickBooks Update Purchase',
  description: 'Sparse-update purchase header fields without changing lines or payment accounts',
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
    purchaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Purchase ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current purchase sync token',
    },
    currentPaymentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Current purchase payment type, re-sent unchanged because QuickBooks requires it for sparse updates',
    },
    vendorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement vendor payee ID',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement purchase date in YYYY-MM-DD format',
    },
    paymentReference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement transaction reference number, such as a check number, sent as the purchase DocNumber',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement internal note',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (p) => buildQuickBooksEntityUrl(p.realmId, 'purchase').toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksUpdatePurchaseBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(r, 'Purchase'),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated native QuickBooks Purchase',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
