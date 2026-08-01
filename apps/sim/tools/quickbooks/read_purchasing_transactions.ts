import { ErrorExtractorId } from '@/tools/error-extractors'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import type {
  QuickBooksPurchasingTransaction,
  QuickBooksReadPurchasingTransactionsParams,
  QuickBooksReadPurchasingTransactionsResponse,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES } from '@/tools/quickbooks/types'
import {
  buildQuickBooksEntityUrl,
  buildQuickBooksQueryUrl,
  getQuickBooksPurchasingEntity,
  getQuickBooksToolHeaders,
  transformQuickBooksEntityResponse,
  transformQuickBooksListResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksReadPurchasingTransactionsTool: ToolConfig<
  QuickBooksReadPurchasingTransactionsParams,
  QuickBooksReadPurchasingTransactionsResponse
> = {
  id: 'quickbooks_read_purchasing_transactions',
  name: 'QuickBooks Read Purchasing Transactions',
  description: 'List or read one purchase order, bill, bill payment, vendor credit, or purchase',
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
      description: 'Purchasing transaction type to read',
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
      const config = getQuickBooksPurchasingEntity(params.transactionType)
      if (params.readMode === 'list') {
        return buildQuickBooksQueryUrl(
          params.realmId,
          config.entity,
          params.startPosition ?? 1,
          params.maxResults ?? 25
        ).toString()
      }
      if (params.readMode === 'by_id') {
        if (!params.transactionId?.trim())
          throw new Error('QuickBooks transaction ID is required for by-ID reads')
        return buildQuickBooksEntityUrl(
          params.realmId,
          config.resource,
          params.transactionId
        ).toString()
      }
      throw new Error(`Unsupported QuickBooks purchasing read mode: ${String(params.readMode)}`)
    },
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
    maxResponseBytes: QUICKBOOKS_MAX_RESPONSE_BYTES,
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks purchasing transaction parameters are required')
    const config = getQuickBooksPurchasingEntity(params.transactionType)
    if (params.readMode === 'list') {
      const result = await transformQuickBooksListResponse<QuickBooksPurchasingTransaction>(
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
      const result = await transformQuickBooksEntityResponse<QuickBooksPurchasingTransaction>(
        response,
        config.entity
      )
      return {
        success: true,
        output: { transactionType: params.transactionType, item: result.item, time: result.time },
      }
    }
    throw new Error(`Unsupported QuickBooks purchasing read mode: ${String(params.readMode)}`)
  },
  outputs: {
    transactionType: { type: 'string', description: 'Purchasing transaction type returned' },
    item: {
      type: 'json',
      description: 'Single native QuickBooks purchasing transaction',
      optional: true,
      properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES,
    },
    items: {
      type: 'array',
      description: 'Native QuickBooks purchasing transactions',
      optional: true,
      items: { type: 'json', properties: QUICKBOOKS_PURCHASING_TRANSACTION_PROPERTIES },
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
