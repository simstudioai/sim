import type { QuickBooksListParams, QuickBooksQueryResponse } from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksListQuery,
  buildQuickBooksQueryUrl,
  extractQuickBooksRecords,
  getQuickBooksQueryMetadata,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksListBillsTool: ToolConfig<QuickBooksListParams, QuickBooksQueryResponse> = {
  id: 'quickbooks_list_bills',
  name: 'QuickBooks List Bills',
  description: 'List bills from QuickBooks Online',
  version: '1.0.0',

  oauth: { required: true, provider: 'quickbooks' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for QuickBooks Online',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
    },
    startPosition: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'One-based start position for QuickBooks query pagination',
    },
    maxResults: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of bills to return, up to 1000',
    },
    minorVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks Accounting API minor version. Defaults to 75.',
    },
  },

  request: {
    url: (params) =>
      buildQuickBooksQueryUrl({
        realmId: params.realmId,
        query: buildQuickBooksListQuery('Bill', params),
        minorVersion: params.minorVersion,
      }),
    method: 'GET',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
  },

  transformResponse: async (response, params) => {
    const data = await parseQuickBooksJson(response)
    const { entity, items } = extractQuickBooksRecords(data, 'Bill')
    const metadata = getQuickBooksQueryMetadata(data)

    return {
      success: true,
      output: {
        items,
        entity,
        totalCount: metadata.totalCount,
        startPosition: metadata.startPosition,
        maxResults: metadata.maxResults,
        query: buildQuickBooksListQuery('Bill', params ?? { accessToken: '', realmId: '' }),
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Bills returned by QuickBooks',
      items: {
        type: 'json',
        properties: {
          Id: { type: 'string', description: 'QuickBooks bill ID', optional: true },
          DocNumber: { type: 'string', description: 'Bill document number', optional: true },
          TxnDate: { type: 'string', description: 'Bill transaction date', optional: true },
          DueDate: { type: 'string', description: 'Bill due date', optional: true },
          TotalAmt: { type: 'number', description: 'Bill total amount', optional: true },
          Balance: { type: 'number', description: 'Open bill balance', optional: true },
        },
      },
    },
    entity: { type: 'string', description: 'QuickBooks entity name' },
    totalCount: {
      type: 'number',
      description: 'Total count returned by QuickBooks',
      optional: true,
    },
    startPosition: {
      type: 'number',
      description: 'Start position returned by QuickBooks',
      optional: true,
    },
    maxResults: {
      type: 'number',
      description: 'Maximum records returned by QuickBooks',
      optional: true,
    },
    query: { type: 'string', description: 'Query that was executed' },
  },
}
