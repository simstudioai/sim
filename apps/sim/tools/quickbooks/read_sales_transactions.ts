import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksReadSalesTransactionsParams,
  QuickBooksReadSalesTransactionsResponse,
  QuickBooksSalesTransaction,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_SALES_TRANSACTION_PROPERTIES } from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  buildQuickBooksSalesQueryUrl,
  getQuickBooksRecordVersion,
  getQuickBooksSalesEntity,
  getQuickBooksToolHeaders,
  transformQuickBooksEntityResponse,
  transformQuickBooksListResponse,
} from '@/tools/quickbooks/utils'
import { assertQuickBooksListOnlyFilters } from '@/tools/quickbooks/values'
import type { ToolConfig } from '@/tools/types'

export const quickbooksReadSalesTransactionsTool: ToolConfig<
  QuickBooksReadSalesTransactionsParams,
  QuickBooksReadSalesTransactionsResponse
> = {
  id: 'quickbooks_read_sales_transactions',
  name: 'QuickBooks Read Sales Transactions',
  description:
    'List or read one estimate, invoice, sales receipt, payment, credit memo, or refund receipt',
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
    transactionType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sales transaction type to read',
    },
    readMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether to list transactions or read one transaction by ID',
    },
    transactionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks transaction ID, required for by-ID reads',
    },
    startPosition: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 1,
      description: 'One-based position of the first list record to return',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 25,
      description: 'Number of list records to request (1–100)',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'List transactions on or after this date in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'List transactions on or before this date in YYYY-MM-DD format',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'List transactions for one QuickBooks customer ID',
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
    url: (params) => {
      const config = getQuickBooksSalesEntity(params.transactionType)
      if (params.readMode === 'list') {
        return buildQuickBooksSalesQueryUrl(params).toString()
      }
      if (params.readMode === 'by_id') {
        assertQuickBooksListOnlyFilters(params.readMode, {
          startDate: params.startDate,
          endDate: params.endDate,
          customerId: params.customerId,
        })
        if (!params.transactionId?.trim()) {
          throw new Error('QuickBooks transaction ID is required for by-ID reads')
        }
        return buildQuickBooksEntityUrl(params, config.resource, params.transactionId).toString()
      }
      throw new Error(`Unsupported QuickBooks sales read mode: ${String(params.readMode)}`)
    },
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks sales transaction parameters are required')
    const config = getQuickBooksSalesEntity(params.transactionType)
    if (params.readMode === 'list') {
      const result = await transformQuickBooksListResponse<QuickBooksSalesTransaction>(
        response,
        {
          ...params,
          startPosition: params.startPosition ?? 1,
          maxResults: params.maxResults ?? 25,
        },
        config.entity
      )
      return {
        success: true,
        output: { transactionType: params.transactionType, ...result.output },
      }
    }
    if (params.readMode === 'by_id') {
      const result = await transformQuickBooksEntityResponse<QuickBooksSalesTransaction>(
        response,
        config.entity
      )
      return {
        success: true,
        output: {
          transactionType: params.transactionType,
          item: result.item,
          recordVersion: getQuickBooksRecordVersion(result.item),
          time: result.time,
        },
      }
    }
    throw new Error(`Unsupported QuickBooks sales read mode: ${String(params.readMode)}`)
  },
  outputs: {
    transactionType: { type: 'string', description: 'Sales transaction type returned' },
    item: {
      type: 'json',
      description: 'Single native QuickBooks sales transaction',
      optional: true,
      properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
    },
    items: {
      type: 'array',
      description: 'Native QuickBooks sales transactions',
      optional: true,
      items: { type: 'json', properties: QUICKBOOKS_SALES_TRANSACTION_PROPERTIES },
    },
    recordVersion: {
      type: 'string',
      description: 'Display-safe alias for the native SyncToken on a by-ID transaction',
      optional: true,
    },
    startPosition: {
      type: 'number',
      description: 'One-based position of the first item in this response',
      optional: true,
    },
    maxResults: {
      type: 'number',
      description: 'Actual number of items reported for this response',
      optional: true,
    },
    nextStartPosition: {
      type: 'number',
      description: 'Position to use when explicitly requesting the next page',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Conservative indication that another page may exist',
      optional: true,
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
      nullable: true,
    },
  },
}
