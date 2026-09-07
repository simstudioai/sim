import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  buildQuickBooksCreateBillBody,
  verifyQuickBooksBillLinks,
} from '@/tools/quickbooks/purchasing_utils'
import type {
  QuickBooksCreateBillParams,
  QuickBooksCreateBillResponse,
  QuickBooksPurchasingTransaction,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_CREATE_BILL_LINK_OUTPUTS,
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

export const quickbooksCreateBillTool: ToolConfig<
  QuickBooksCreateBillParams,
  QuickBooksCreateBillResponse
> = {
  id: 'quickbooks_create_bill',
  name: 'QuickBooks Create Bill',
  description: 'Create a vendor bill with optional Purchase Order line links without paying it',
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
      description: 'Bill vendor ID',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Bounded account-based or item-based expense lines with optional paired Purchase Order and line IDs',
    },
    apAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional accounts-payable account ID',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill date in YYYY-MM-DD format',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bill due date in YYYY-MM-DD format',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional bill number',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal bill note',
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
    url: (p) => addQuickBooksRequestId(buildQuickBooksEntityUrl(p, 'bill'), p.requestId).toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksCreateBillBody,
    retry: { enabled: false },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks Create Bill parameters are required')
    const transformed = await transformQuickBooksMutationResponse<QuickBooksPurchasingTransaction>(
      response,
      'Bill'
    )
    return {
      ...transformed,
      output: {
        ...transformed.output,
        ...verifyQuickBooksBillLinks(
          transformed.output.record,
          params.lines,
          transformed.output.recordId
        ),
      },
    }
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Created native QuickBooks Bill',
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
    ...QUICKBOOKS_CREATE_BILL_LINK_OUTPUTS,
  },
}
