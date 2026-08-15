import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  PlaidSyncTransactionsParams,
  PlaidSyncTransactionsResponse,
} from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidRemovedTransaction,
  mapPlaidTransaction,
  plaidAccessTokenParamField,
  plaidBaseParamFields,
  plaidBody,
  plaidRecord,
  plaidTransactionOutputProperties,
  plaidUrl,
  toPlaidOptionalBoolean,
  toPlaidOptionalNumber,
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
    ...plaidAccessTokenParamField,
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
    url: (params) => plaidUrl(params, '/transactions/sync'),
    method: 'POST',
    headers: (params) => buildPlaidHeaders(params),
    body: (params) => {
      const options = plaidBody({
        account_id: params.accountId?.trim() || undefined,
        include_original_description: toPlaidOptionalBoolean(params.includeOriginalDescription),
        days_requested: toPlaidOptionalNumber(params.daysRequested, 'daysRequested'),
      })
      return plaidBody({
        access_token: params.accessToken.trim(),
        cursor: params.cursor?.trim() || undefined,
        count: toPlaidOptionalNumber(params.count, 'count'),
        options: Object.keys(options).length > 0 ? options : undefined,
      })
    },
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'transaction sync')
    const added = Array.isArray(data.added) ? data.added : []
    const modified = Array.isArray(data.modified) ? data.modified : []
    const removed = Array.isArray(data.removed) ? data.removed : []
    return {
      success: true,
      output: {
        added: added.map(mapPlaidTransaction),
        modified: modified.map(mapPlaidTransaction),
        removed: removed.map(mapPlaidRemovedTransaction),
        nextCursor: typeof data.next_cursor === 'string' ? data.next_cursor : '',
        hasMore: data.has_more === true,
        updateStatus:
          typeof data.transactions_update_status === 'string'
            ? data.transactions_update_status
            : '',
      },
    }
  },

  outputs: {
    added: {
      type: 'array',
      description: 'Transactions added since the cursor',
      items: { type: 'json', properties: plaidTransactionOutputProperties },
    },
    modified: {
      type: 'array',
      description: 'Transactions modified since the cursor',
      items: { type: 'json', properties: plaidTransactionOutputProperties },
    },
    removed: {
      type: 'array',
      description: 'Transactions removed since the cursor',
      items: {
        type: 'json',
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
        'Sync readiness: NOT_READY, INITIAL_UPDATE_COMPLETE, or HISTORICAL_UPDATE_COMPLETE',
    },
  },
}
