import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceOpportunities')

function getInstanceUrl(idToken?: string, instanceUrl?: string): string {
  if (instanceUrl) return instanceUrl
  if (idToken) {
    try {
      const base64Url = idToken.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
          .join('')
      )
      const decoded = JSON.parse(jsonPayload)
      if (decoded.profile) {
        const match = decoded.profile.match(/^(https:\/\/[^/]+)/)
        if (match) return match[1]
      } else if (decoded.sub) {
        const match = decoded.sub.match(/^(https:\/\/[^/]+)/)
        if (match && match[1] !== 'https://login.salesforce.com') return match[1]
      }
    } catch (error) {
      logger.error('Failed to decode Salesforce idToken', { error })
    }
  }
  throw new Error('Salesforce instance URL is required but not provided')
}

// Get Opportunities
export const salesforceGetOpportunitiesTool: ToolConfig<any, any> = {
  id: 'salesforce_get_opportunities',
  name: 'Get Opportunities from Salesforce',
  description: 'Get opportunity(ies) from Salesforce',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
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
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok)
      throw new Error(data[0]?.message || data.message || 'Failed to fetch opportunities')
    if (params.opportunityId) {
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

// Create Opportunity
export const salesforceCreateOpportunityTool: ToolConfig<any, any> = {
  id: 'salesforce_create_opportunity',
  name: 'Create Opportunity in Salesforce',
  description: 'Create a new opportunity',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Opportunity name (required)',
    },
    stageName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stage name (required)',
    },
    closeDate: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Close date YYYY-MM-DD (required)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID',
    },
    amount: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Amount (number)',
    },
    probability: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Probability (0-100)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Opportunity`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        Name: params.name,
        StageName: params.stageName,
        CloseDate: params.closeDate,
      }
      if (params.accountId) body.AccountId = params.accountId
      if (params.amount) body.Amount = Number.parseFloat(params.amount)
      if (params.probability) body.Probability = Number.parseInt(params.probability)
      if (params.description) body.Description = params.description
      return body
    },
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok)
      throw new Error(data[0]?.message || data.message || 'Failed to create opportunity')
    return {
      success: true,
      output: {
        id: data.id,
        success: data.success,
        created: true,
        metadata: { operation: 'create_opportunity' },
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Created opportunity' },
  },
}

// Update Opportunity
export const salesforceUpdateOpportunityTool: ToolConfig<any, any> = {
  id: 'salesforce_update_opportunity',
  name: 'Update Opportunity in Salesforce',
  description: 'Update an existing opportunity',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Opportunity ID (required)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Opportunity name',
    },
    stageName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Stage name',
    },
    closeDate: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Close date YYYY-MM-DD',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID',
    },
    amount: { type: 'string', required: false, visibility: 'user-only', description: 'Amount' },
    probability: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Probability (0-100)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Opportunity/${params.opportunityId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.name) body.Name = params.name
      if (params.stageName) body.StageName = params.stageName
      if (params.closeDate) body.CloseDate = params.closeDate
      if (params.accountId) body.AccountId = params.accountId
      if (params.amount) body.Amount = Number.parseFloat(params.amount)
      if (params.probability) body.Probability = Number.parseInt(params.probability)
      if (params.description) body.Description = params.description
      return body
    },
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data[0]?.message || data.message || 'Failed to update opportunity')
    }
    return {
      success: true,
      output: {
        id: params.opportunityId,
        updated: true,
        metadata: { operation: 'update_opportunity' },
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Updated opportunity' },
  },
}

// Delete Opportunity
export const salesforceDeleteOpportunityTool: ToolConfig<any, any> = {
  id: 'salesforce_delete_opportunity',
  name: 'Delete Opportunity from Salesforce',
  description: 'Delete an opportunity',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Opportunity ID (required)',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Opportunity/${params.opportunityId}`,
    method: 'DELETE',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data[0]?.message || data.message || 'Failed to delete opportunity')
    }
    return {
      success: true,
      output: {
        id: params.opportunityId,
        deleted: true,
        metadata: { operation: 'delete_opportunity' },
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Deleted opportunity' },
  },
}
