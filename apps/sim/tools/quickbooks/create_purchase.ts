import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksCreatePurchaseBody } from '@/tools/quickbooks/purchasing_utils'
import type {
  QuickBooksCreatePurchaseParams,
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

export const quickbooksCreatePurchaseTool: ToolConfig<
  QuickBooksCreatePurchaseParams,
  QuickBooksMutationResponse<QuickBooksPurchasingTransaction>
> = {
  id: 'quickbooks_create_purchase',
  name: 'QuickBooks Create Purchase',
  description: 'Record a cash, check, or credit-card purchase with bounded expense lines',
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
    paymentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cash, check, or credit-card purchase type',
    },
    paymentAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bank or credit-card account ID matching the purchase type',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bounded account-based or item-based expense lines',
    },
    vendorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional vendor payee ID',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Purchase date in YYYY-MM-DD format',
    },
    paymentReference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional transaction reference number, such as a check number, sent as the purchase DocNumber',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal purchase note',
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
      addQuickBooksRequestId(buildQuickBooksEntityUrl(p, 'purchase'), p.requestId).toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksCreatePurchaseBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(r, 'Purchase'),
  outputs: {
    record: {
      type: 'json',
      description: 'Created native QuickBooks Purchase',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
