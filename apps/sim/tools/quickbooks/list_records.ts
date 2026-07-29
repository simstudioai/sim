import type { QuickBooksListRecordsParams, QuickBooksQueryResponse } from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksListRecordsQuery,
  buildQuickBooksQueryUrl,
  extractQuickBooksRecords,
  getQuickBooksQueryMetadata,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksListRecordsTool: ToolConfig<
  QuickBooksListRecordsParams,
  QuickBooksQueryResponse
> = {
  id: 'quickbooks_list_records',
  name: 'QuickBooks List Records',
  description: 'List or filter records for a supported QuickBooks Online accounting entity',
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
      visibility: 'user-only',
      description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
    },
    entity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Queryable QuickBooks entity name',
    },
    whereClause: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks query WHERE clause without the WHERE keyword',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks query ORDERBY clause without the ORDERBY keyword',
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
      description: 'Maximum number of records to return, up to 1000',
    },
    apiEnvironment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks API environment: production or sandbox. Defaults to production.',
    },
    minorVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks Accounting API minor version. Defaults to 75.',
    },
  },

  request: {
    url: (params) => {
      const { query } = buildQuickBooksListRecordsQuery(params)
      return buildQuickBooksQueryUrl({
        realmId: params.realmId,
        query,
        apiEnvironment: params.apiEnvironment,
        minorVersion: params.minorVersion,
      })
    },
    method: 'GET',
    headers: (params) => buildQuickBooksHeaders(params.accessToken),
  },

  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks list parameters are required')
    const { entity, query } = buildQuickBooksListRecordsQuery(params)
    const data = await parseQuickBooksJson(response)
    const { items } = extractQuickBooksRecords(data, entity)
    const metadata = getQuickBooksQueryMetadata(data)

    return {
      success: true,
      output: {
        items,
        entity,
        totalCount: metadata.totalCount,
        startPosition: metadata.startPosition,
        maxResults: metadata.maxResults,
        query,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'QuickBooks records for the selected entity',
      items: {
        type: 'json',
        description: 'Entity-specific QuickBooks record',
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
