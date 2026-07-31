import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import type {
  QuickBooksReadSalesTransactionsParams,
  QuickBooksReadSalesTransactionsResponse,
  QuickBooksSalesTransaction,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_LIST_OUTPUTS,
  QUICKBOOKS_SALES_TRANSACTION_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  buildQuickBooksQueryUrl,
  getQuickBooksSalesEntity,
  getQuickBooksToolHeaders,
  transformQuickBooksEntityResponse,
  transformQuickBooksListResponse,
} from '@/tools/quickbooks/utils'
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
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => {
      const config = getQuickBooksSalesEntity(params.transactionType)
      if (params.readMode === 'list') {
        return buildQuickBooksQueryUrl(
          params.realmId,
          config.entity,
          params.startPosition ?? 1,
          params.maxResults ?? 25
        ).toString()
      }
      if (params.readMode === 'by_id') {
        if (!params.transactionId?.trim()) {
          throw new Error('QuickBooks transaction ID is required for by-ID reads')
        }
        return buildQuickBooksEntityUrl(
          params.realmId,
          config.resource,
          params.transactionId
        ).toString()
      }
      throw new Error(`Unsupported QuickBooks sales read mode: ${String(params.readMode)}`)
    },
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
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
        output: { transactionType: params.transactionType, item: result.item, time: result.time },
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
    ...QUICKBOOKS_LIST_OUTPUTS,
  },
}
