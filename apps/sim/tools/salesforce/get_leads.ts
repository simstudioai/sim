import type { SalesforceGetLeadsParams, SalesforceGetLeadsResponse } from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceGetLeadsTool: ToolConfig<
  SalesforceGetLeadsParams,
  SalesforceGetLeadsResponse
> = {
  id: 'salesforce_get_leads',
  name: 'Get Leads from Salesforce',
  description: 'Get lead(s) from Salesforce',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    leadId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Lead ID (optional)',
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
      if (params.leadId) {
        const fields =
          params.fields || 'Id,FirstName,LastName,Company,Email,Phone,Status,LeadSource'
        return `${instanceUrl}/services/data/v59.0/sobjects/Lead/${params.leadId}?fields=${fields}`
      }
      const limit = params.limit ? Number.parseInt(params.limit) : 100
      const fields = params.fields || 'Id,FirstName,LastName,Company,Email,Phone,Status,LeadSource'
      const orderBy = params.orderBy || 'LastName ASC'
      const query = `SELECT ${fields} FROM Lead ORDER BY ${orderBy} LIMIT ${limit}`
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
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to fetch leads')
    if (params?.leadId) {
      return {
        success: true,
        output: {
          lead: data,
          singleLead: true,
          success: true,
        },
      }
    }
    const leads = data.records || []
    return {
      success: true,
      output: {
        leads,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl ?? null,
          totalSize: data.totalSize || leads.length,
          done: data.done !== false,
        },
        metadata: {
          totalReturned: leads.length,
          hasMore: !data.done,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Lead data',
      properties: {
        lead: { type: 'object', description: 'Single lead object (when leadId provided)' },
        leads: { type: 'array', description: 'Array of lead objects (when listing)' },
        paging: {
          type: 'object',
          description: 'Pagination information',
          properties: {
            nextRecordsUrl: {
              type: 'string',
              description: 'URL for next page of results',
              optional: true,
            },
            totalSize: { type: 'number', description: 'Total number of records' },
            done: { type: 'boolean', description: 'Whether all records returned' },
          },
        },
        metadata: {
          type: 'object',
          description: 'Response metadata',
          properties: {
            totalReturned: { type: 'number', description: 'Number of leads returned' },
            hasMore: { type: 'boolean', description: 'Whether more records exist' },
          },
        },
        singleLead: { type: 'boolean', description: 'Whether single lead was returned' },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
