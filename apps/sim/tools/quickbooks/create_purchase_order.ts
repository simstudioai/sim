import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksCreatePurchaseOrderBody } from '@/tools/quickbooks/purchasing_utils'
import type {
  QuickBooksCreatePurchaseOrderParams,
  QuickBooksMutationResponse,
  QuickBooksPurchasingTransaction,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreatePurchaseOrderTool: ToolConfig<
  QuickBooksCreatePurchaseOrderParams,
  QuickBooksMutationResponse<QuickBooksPurchasingTransaction>
> = {
  id: 'quickbooks_create_purchase_order',
  name: 'QuickBooks Create Purchase Order',
  description: 'Create a purchase order with bounded expense lines',
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
    vendorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Purchase-order vendor ID',
    },
    apAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Accounts-payable account ID',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bounded account-based or item-based expense lines',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Purchase-order date in YYYY-MM-DD format',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional purchase-order number',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal purchase-order note',
    },
    currencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Three-letter ISO 4217 currency code, required when multicurrency is enabled for the company',
    },
    globalTaxCalculation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tax treatment required for non-US companies: TaxExcluded, TaxInclusive, or NotApplicable',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date the payment is due in YYYY-MM-DD format',
    },
    requestId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Intuit idempotency request ID, up to 50 characters',
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
    url: (p) =>
      addQuickBooksRequestId(buildQuickBooksEntityUrl(p, 'purchaseorder'), p.requestId).toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksCreatePurchaseOrderBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(r, 'PurchaseOrder'),
  outputs: {
    record: {
      type: 'json',
      description: 'Created native QuickBooks PurchaseOrder',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
