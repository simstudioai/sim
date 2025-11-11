import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceLeads')

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

// Get Leads
export interface SalesforceGetLeadsParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  leadId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export const salesforceGetLeadsTool: ToolConfig<any, any> = {
  id: 'salesforce_get_leads',
  name: 'Get Leads from Salesforce',
  description: 'Get lead(s) from Salesforce',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
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
  transformResponse: async (response, params) => {
    const data = await response.json()
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to fetch leads')
    if (params.leadId) {
      return {
        success: true,
        output: {
          lead: data,
          metadata: { operation: 'get_leads', singleLead: true },
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
          nextRecordsUrl: data.nextRecordsUrl,
          totalSize: data.totalSize || leads.length,
          done: data.done !== false,
        },
        metadata: { operation: 'get_leads', totalReturned: leads.length, hasMore: !data.done },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    output: { type: 'object', description: 'Lead data' },
  },
}

// Create Lead
export const salesforceCreateLeadTool: ToolConfig<any, any> = {
  id: 'salesforce_create_lead',
  name: 'Create Lead in Salesforce',
  description: 'Create a new lead',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Last name (required)',
    },
    company: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Company (required)',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'First name',
    },
    email: { type: 'string', required: false, visibility: 'user-only', description: 'Email' },
    phone: { type: 'string', required: false, visibility: 'user-only', description: 'Phone' },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Lead status',
    },
    leadSource: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Lead source',
    },
    title: { type: 'string', required: false, visibility: 'user-only', description: 'Title' },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Lead`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = { LastName: params.lastName, Company: params.company }
      if (params.firstName) body.FirstName = params.firstName
      if (params.email) body.Email = params.email
      if (params.phone) body.Phone = params.phone
      if (params.status) body.Status = params.status
      if (params.leadSource) body.LeadSource = params.leadSource
      if (params.title) body.Title = params.title
      if (params.description) body.Description = params.description
      return body
    },
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to create lead')
    return {
      success: true,
      output: {
        id: data.id,
        success: data.success,
        created: true,
        metadata: { operation: 'create_lead' },
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Created lead' },
  },
}

// Update Lead
export const salesforceUpdateLeadTool: ToolConfig<any, any> = {
  id: 'salesforce_update_lead',
  name: 'Update Lead in Salesforce',
  description: 'Update an existing lead',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Lead ID (required)',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Last name',
    },
    company: { type: 'string', required: false, visibility: 'user-only', description: 'Company' },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'First name',
    },
    email: { type: 'string', required: false, visibility: 'user-only', description: 'Email' },
    phone: { type: 'string', required: false, visibility: 'user-only', description: 'Phone' },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Lead status',
    },
    leadSource: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Lead source',
    },
    title: { type: 'string', required: false, visibility: 'user-only', description: 'Title' },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Lead/${params.leadId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.lastName) body.LastName = params.lastName
      if (params.company) body.Company = params.company
      if (params.firstName) body.FirstName = params.firstName
      if (params.email) body.Email = params.email
      if (params.phone) body.Phone = params.phone
      if (params.status) body.Status = params.status
      if (params.leadSource) body.LeadSource = params.leadSource
      if (params.title) body.Title = params.title
      if (params.description) body.Description = params.description
      return body
    },
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data[0]?.message || data.message || 'Failed to update lead')
    }
    return {
      success: true,
      output: { id: params.leadId, updated: true, metadata: { operation: 'update_lead' } },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Updated lead' },
  },
}

// Delete Lead
export const salesforceDeleteLeadTool: ToolConfig<any, any> = {
  id: 'salesforce_delete_lead',
  name: 'Delete Lead from Salesforce',
  description: 'Delete a lead',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Lead ID (required)',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Lead/${params.leadId}`,
    method: 'DELETE',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data[0]?.message || data.message || 'Failed to delete lead')
    }
    return {
      success: true,
      output: { id: params.leadId, deleted: true, metadata: { operation: 'delete_lead' } },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Deleted lead' },
  },
}
