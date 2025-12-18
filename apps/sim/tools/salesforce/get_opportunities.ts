import type {
  SalesforceGetOpportunitiesParams,
  SalesforceGetOpportunitiesResponse,
} from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceGetOpportunitiesTool: ToolConfig<
  SalesforceGetOpportunitiesParams,
  SalesforceGetOpportunitiesResponse
> = {
  id: 'salesforce_get_opportunities',
  name: 'Get Opportunities from Salesforce',
  description: 'Get opportunity(ies) from Salesforce',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    opportunityId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Opportunity ID (optional)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Max results (default: 100)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated fields',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Order by field',
    },
  },

  request: {
    url: (params) => {
      const instanceUrl = getInstanceUrl(params.idToken, params.instanceUrl)
      if (params.opportunityId) {
        const fields = params.fields || 'Id,Name,AccountId,Amount,StageName,CloseDate,Probability'
        return `${instanceUrl}/services/data/v59.0/sobjects/Opportunity/${params.opportunityId}?fields=${fields}`
      }
      const limit = params.limit ? Number.parseInt(params.limit) : 100
      const fields = params.fields || 'Id,Name,AccountId,Amount,StageName,CloseDate,Probability'
      const orderBy = params.orderBy || 'CloseDate DESC'
      const query = `SELECT ${fields} FROM Opportunity ORDER BY ${orderBy} LIMIT ${limit}`
      return `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(query)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params?) => {
    const data = await response.json()
    if (!response.ok)
      throw new Error(data[0]?.message || data.message || 'Failed to fetch opportunities')
    if (params?.opportunityId) {
      return {
        success: true,
        output: { opportunity: data, metadata: { operation: 'get_opportunities' }, success: true },
      }
    }
    const opportunities = data.records || []
    return {
      success: true,
      output: {
        opportunities,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl,
          totalSize: data.totalSize || opportunities.length,
          done: data.done !== false,
        },
        metadata: {
          operation: 'get_opportunities',
          totalReturned: opportunities.length,
          hasMore: !data.done,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Opportunity data' },
  },
}
