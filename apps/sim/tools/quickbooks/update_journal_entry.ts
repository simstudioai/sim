import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksUpdateJournalEntryBody } from '@/tools/quickbooks/accounting_utils'
import type {
  QuickBooksAccountingTransaction,
  QuickBooksMutationResponse,
  QuickBooksUpdateJournalEntryParams,
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

export const quickbooksUpdateJournalEntryTool: ToolConfig<
  QuickBooksUpdateJournalEntryParams,
  QuickBooksMutationResponse<QuickBooksAccountingTransaction>
> = {
  id: 'quickbooks_update_journal_entry',
  name: 'QuickBooks Update Journal Entry',
  description: 'Sparse-update journal-entry header fields after explicit confirmation',
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
    journalEntryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Journal Entry ID to update',
    },
    syncToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Current journal-entry sync token',
    },
    confirmPosting: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Explicit confirmation that this journal-entry update should be posted',
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
      description: 'Replacement journal-entry number',
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
    url: (p) => buildQuickBooksEntityUrl(p, 'journalentry').toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksUpdateJournalEntryBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksAccountingTransaction>(r, 'JournalEntry'),
  outputs: {
    record: {
      type: 'json',
      description: 'Updated native QuickBooks JournalEntry',
      properties: QUICKBOOKS_ACCOUNTING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
