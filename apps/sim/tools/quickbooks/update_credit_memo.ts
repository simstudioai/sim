import { ErrorExtractorId } from '@/tools/error-extractors'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  QuickBooksMutationResponse,
  QuickBooksSalesTransaction,
  QuickBooksUpdateCreditMemoParams,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_MUTATION_OUTPUTS,
  QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import type { InternalToolConfig } from '@/tools/types'

export const quickbooksUpdateCreditMemoTool: InternalToolConfig<
  QuickBooksUpdateCreditMemoParams,
  QuickBooksMutationResponse<QuickBooksSalesTransaction>
> = {
  id: 'quickbooks_update_credit_memo',
  name: 'QuickBooks Update Credit Memo',
  description: 'Read, merge, and full-update a credit memo using its current sync token',
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
      description: 'Credit memo ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current credit memo sync token',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer ID',
    },
    lines: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Complete replacement set of credit memo lines: any existing line omitted here is deleted from the credit memo',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement credit memo date in YYYY-MM-DD format',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement credit memo number',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement internal note',
    },
    customerMemo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement customer-facing memo',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  operation: {
    input: createInternalToolOperationInput,
  },
  outputs: {
    record: {
      type: 'json',
      description: 'Updated native QuickBooks CreditMemo',
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
