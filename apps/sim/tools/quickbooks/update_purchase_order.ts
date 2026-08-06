import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksUpdatePurchaseOrderBody } from '@/tools/quickbooks/purchasing_utils'
import type {
  QuickBooksMutationResponse,
  QuickBooksPurchasingTransaction,
  QuickBooksUpdatePurchaseOrderParams,
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

export const quickbooksUpdatePurchaseOrderTool: ToolConfig<
  QuickBooksUpdatePurchaseOrderParams,
  QuickBooksMutationResponse<QuickBooksPurchasingTransaction>
> = {
  id: 'quickbooks_update_purchase_order',
  name: 'QuickBooks Update Purchase Order',
  description: 'Sparse-update purchase-order header fields using the current sync token',
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
    purchaseOrderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Purchase Order ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current purchase-order sync token',
    },
    vendorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement vendor ID',
    },
    apAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement accounts-payable account ID',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement date in YYYY-MM-DD format',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement purchase-order number',
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
    url: (p) => buildQuickBooksEntityUrl(p.realmId, 'purchaseorder').toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksUpdatePurchaseOrderBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(r, 'PurchaseOrder'),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated native QuickBooks PurchaseOrder',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
