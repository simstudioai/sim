import type { QuickBooksQueryParams, QuickBooksQueryResponse } from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksQueryEndpoint,
  extractQuickBooksRecords,
  getQuickBooksQueryMetadata,
  normalizeQuickBooksQuery,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksQueryTool: ToolConfig<QuickBooksQueryParams, QuickBooksQueryResponse> = {
  id: 'quickbooks_query',
  name: 'QuickBooks Query',
  description: 'Run a QuickBooks Online Accounting API query',
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
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks SQL-like query, e.g. SELECT * FROM Vendor MAXRESULTS 10',
    },
    minorVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'QuickBooks Accounting API minor version. Defaults to 75.',
    },
  },

  request: {
    url: (params) => buildQuickBooksQueryEndpoint(params),
    method: 'POST',
    headers: (params) => ({
      ...buildQuickBooksHeaders(params.accessToken),
      'Content-Type': 'application/text',
    }),
    body: (params) => normalizeQuickBooksQuery(params.query),
  },

  transformResponse: async (response, params) => {
    const data = await parseQuickBooksJson(response)
    const { entity, items } = extractQuickBooksRecords(data)
    const metadata = getQuickBooksQueryMetadata(data)

    return {
      success: true,
      output: {
        items,
        entity,
        totalCount: metadata.totalCount,
        startPosition: metadata.startPosition,
        maxResults: metadata.maxResults,
        query: params?.query ?? '',
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Records returned by the QuickBooks query',
      items: { type: 'json', description: 'QuickBooks entity record' },
    },
    entity: {
      type: 'string',
      description: 'QuickBooks entity name returned by the query',
      optional: true,
    },
    totalCount: {
      type: 'number',
      description: 'Total count returned by QuickBooks for the query',
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
