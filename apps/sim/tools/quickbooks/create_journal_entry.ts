import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildQuickBooksCreateJournalEntryBody } from '@/tools/quickbooks/accounting_utils'
import type {
  QuickBooksAccountingTransaction,
  QuickBooksCreateJournalEntryParams,
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

export const quickbooksCreateJournalEntryTool: ToolConfig<
  QuickBooksCreateJournalEntryParams,
  QuickBooksMutationResponse<QuickBooksAccountingTransaction>
> = {
  id: 'quickbooks_create_journal_entry',
  name: 'QuickBooks Create Journal Entry',
  description: 'Post a balanced journal entry after explicit confirmation',
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
    lines: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Two to 100 balanced debit and credit lines',
    },
    confirmPosting: {
      type: 'boolean',
      required: true,
      visibility: 'user-only',
      description: 'Explicit confirmation that this journal entry should be posted',
    },
    transactionDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Journal-entry date in YYYY-MM-DD format',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional journal-entry number',
    },
    privateNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal journal-entry note',
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
      addQuickBooksRequestId(buildQuickBooksEntityUrl(p, 'journalentry'), p.requestId).toString(),
    method: 'POST',
    headers: (p) => getQuickBooksToolHeaders(p.accessToken, 'application/json'),
    body: buildQuickBooksCreateJournalEntryBody,
    retry: { enabled: false },
  },
  transformResponse: (r) =>
    transformQuickBooksMutationResponse<QuickBooksAccountingTransaction>(r, 'JournalEntry'),
  outputs: {
    record: {
      type: 'json',
      description: 'Created native QuickBooks JournalEntry',
      properties: QUICKBOOKS_ACCOUNTING_TRANSACTION_PROPERTIES,
    },
    ...QUICKBOOKS_MUTATION_OUTPUTS,
  },
}
