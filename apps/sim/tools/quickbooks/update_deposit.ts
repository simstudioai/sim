import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksUpdateDepositBody } from '@/tools/quickbooks/accounting_utils'
import type {
  QuickBooksAccountingTransaction,
  QuickBooksMutationResponse,
  QuickBooksUpdateDepositParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_ACCOUNTING_TRANSACTION_PROPERTIES,
  QUICKBOOKS_MUTATION_OUTPUTS,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksMutationResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksUpdateDepositTool: ToolConfig<
  QuickBooksUpdateDepositParams,
  QuickBooksMutationResponse<QuickBooksAccountingTransaction>
> = {
  id: 'quickbooks_update_deposit',
  name: 'QuickBooks Update Deposit',
  description:
    'Sparse-update deposit header fields using the current sync token and destination account',
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
    depositId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Deposit ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current deposit sync token',
    },
    depositAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement QuickBooks account receiving the deposit',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement date in YYYY-MM-DD format',
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
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (p) => buildQuickBooksEntityUrl(p, 'deposit').toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksUpdateDepositBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksAccountingTransaction>(r, 'Deposit'),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated native QuickBooks Deposit',
      properties: QUICKBOOKS_ACCOUNTING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
