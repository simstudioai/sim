import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksCreateDepositBody } from '@/tools/quickbooks/accounting_utils'
import type {
  QuickBooksAccountingTransaction,
  QuickBooksCreateDepositParams,
  QuickBooksMutationResponse,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_ACCOUNTING_TRANSACTION_PROPERTIES,
  QUICKBOOKS_MUTATION_OUTPUTS,
} from '@/tools/quickbooks/types'
import {
  addQuickBooksRequestId,
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksCreateDepositTool: ToolConfig<
  QuickBooksCreateDepositParams,
  QuickBooksMutationResponse<QuickBooksAccountingTransaction>
> = {
  id: 'quickbooks_create_deposit',
  name: 'QuickBooks Create Deposit',
  description: 'Create a deposit with bounded account lines',
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
    depositAccountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bank or asset account receiving the deposit',
    },
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'One to 100 account-based deposit lines',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deposit date in YYYY-MM-DD format',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal deposit note',
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
      addQuickBooksRequestId(buildQuickBooksEntityUrl(p, 'deposit'), p.requestId).toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksCreateDepositBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksAccountingTransaction>(r, 'Deposit'),
  outputs: {
    record: {
      type: 'json',
      description: 'Created native QuickBooks Deposit',
      properties: QUICKBOOKS_ACCOUNTING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
