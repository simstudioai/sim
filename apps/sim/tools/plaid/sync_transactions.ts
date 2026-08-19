import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaidSyncTransactionsParams,
  PlaidSyncTransactionsResponse,
} from '@/tools/plaid/types'
import {
  buildPlaidInternalBody,
  mapPlaidRemovedTransaction,
  mapPlaidTransaction,
  plaidBaseParamFields,
  plaidRecord,
  plaidTransactionOutputProperties,
  requirePlaidArrayField,
  requirePlaidBooleanField,
  requirePlaidStringField,
  toPlaidOptionalBoolean,
  toPlaidOptionalNumber,
  toPlaidOptionalString,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidSyncTransactionsTool: ToolConfig<
  PlaidSyncTransactionsParams,
  PlaidSyncTransactionsResponse
> = {
  id: 'plaid_sync_transactions',
  name: 'Plaid Sync Transactions',
  description:
    'Incrementally sync transactions for a linked Item. Omit the cursor on the first call to get full history, then pass the returned cursor to fetch only changes; loop while hasMore is true. If Plaid returns TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION, discard the pages from the current batch and restart the loop from the cursor the batch started with',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidBaseParamFields,
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous sync (nextCursor); omit to start from the beginning',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of updates to fetch per page (1-500, default 100)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Scope the sync (and cursor) to a single account ID',
    },
    includeOriginalDescription: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the unmodified original_description from the institution',
    },
    daysRequested: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Days of history to request (1-730, default 90). Only applies before Transactions is initialized on the Item',
    },
  },

  request: {
    url: '/api/tools/plaid',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) =>
      buildPlaidInternalBody('plaid_sync_transactions', params, {
        cursor: toPlaidOptionalString(params.cursor, 'cursor', { maxLength: 256 }),
        count: toPlaidOptionalNumber(params.count, 'count', {
          integer: true,
          min: 1,
          max: 500,
        }),
        account_id: toPlaidOptionalString(params.accountId, 'accountId'),
        include_original_description: toPlaidOptionalBoolean(
          params.includeOriginalDescription,
          'includeOriginalDescription'
        ),
        days_requested: toPlaidOptionalNumber(params.daysRequested, 'daysRequested', {
          integer: true,
          min: 1,
          max: 730,
        }),
      }),
    internalAuth: 'executor_delegation',
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'transaction sync')
    const added = requirePlaidArrayField(data, 'added', 'transaction sync.added')
    const modified = requirePlaidArrayField(data, 'modified', 'transaction sync.modified')
    const removed = requirePlaidArrayField(data, 'removed', 'transaction sync.removed')
    return {
      success: true,
      output: {
        added: added.map((entry, index) =>
          mapPlaidTransaction(entry, `transaction sync.added[${index}]`)
        ),
        modified: modified.map((entry, index) =>
          mapPlaidTransaction(entry, `transaction sync.modified[${index}]`)
        ),
        removed: removed.map((entry, index) =>
          mapPlaidRemovedTransaction(entry, `transaction sync.removed[${index}]`)
        ),
        nextCursor: requirePlaidStringField(data, 'next_cursor', 'transaction sync.next_cursor'),
        hasMore: requirePlaidBooleanField(data, 'has_more', 'transaction sync.has_more'),
        updateStatus: requirePlaidStringField(
          data,
          'transactions_update_status',
          'transaction sync.transactions_update_status'
        ),
      },
    }
  },

  outputs: {
    added: {
      type: 'array',
      description: 'Transactions added since the cursor',
      items: { type: 'object', properties: plaidTransactionOutputProperties },
    },
    modified: {
      type: 'array',
      description: 'Transactions modified since the cursor',
      items: { type: 'object', properties: plaidTransactionOutputProperties },
    },
    removed: {
      type: 'array',
      description: 'Transactions removed since the cursor',
      items: {
        type: 'object',
        properties: {
          transaction_id: { type: 'string', description: 'ID of the removed transaction' },
          account_id: { type: 'string', description: 'Account the transaction belonged to' },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor to pass to the next sync call to fetch only new changes',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more updates are available; if true, call again with nextCursor',
    },
    updateStatus: {
      type: 'string',
      description:
        'Sync readiness, including TRANSACTIONS_UPDATE_STATUS_UNKNOWN, NOT_READY, INITIAL_UPDATE_COMPLETE, or HISTORICAL_UPDATE_COMPLETE',
    },
  },
}
