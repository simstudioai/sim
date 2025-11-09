import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceCases')

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

// Get Cases
export const salesforceGetCasesTool: ToolConfig<any, any> = {
  id: 'salesforce_get_cases',
  name: 'Get Cases from Salesforce',
  description: 'Get case(s) from Salesforce',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    caseId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Case ID (optional)',
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
      if (params.caseId) {
        const fields =
          params.fields || 'Id,CaseNumber,Subject,Status,Priority,Origin,ContactId,AccountId'
        return `${instanceUrl}/services/data/v59.0/sobjects/Case/${params.caseId}?fields=${fields}`
      }
      const limit = params.limit ? Number.parseInt(params.limit) : 100
      const fields =
        params.fields || 'Id,CaseNumber,Subject,Status,Priority,Origin,ContactId,AccountId'
      const orderBy = params.orderBy || 'CreatedDate DESC'
      const query = `SELECT ${fields} FROM Case ORDER BY ${orderBy} LIMIT ${limit}`
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
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to fetch cases')
    if (params.caseId) {
      return {
        success: true,
        output: { case: data, metadata: { operation: 'get_cases' }, success: true },
      }
    }
    const cases = data.records || []
    return {
      success: true,
      output: {
        cases,
        paging: {
          nextRecordsUrl: data.nextRecordsUrl,
          totalSize: data.totalSize || cases.length,
          done: data.done !== false,
        },
        metadata: { operation: 'get_cases', totalReturned: cases.length, hasMore: !data.done },
        success: true,
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Case data' },
  },
}

// Create Case
export const salesforceCreateCaseTool: ToolConfig<any, any> = {
  id: 'salesforce_create_case',
  name: 'Create Case in Salesforce',
  description: 'Create a new case',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Case subject (required)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Status (e.g., New, Working, Escalated)',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Priority (e.g., Low, Medium, High)',
    },
    origin: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Origin (e.g., Phone, Email, Web)',
    },
    contactId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Contact ID',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID',
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
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Case`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = { Subject: params.subject }
      if (params.status) body.Status = params.status
      if (params.priority) body.Priority = params.priority
      if (params.origin) body.Origin = params.origin
      if (params.contactId) body.ContactId = params.contactId
      if (params.accountId) body.AccountId = params.accountId
      if (params.description) body.Description = params.description
      return body
    },
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) throw new Error(data[0]?.message || data.message || 'Failed to create case')
    return {
      success: true,
      output: {
        id: data.id,
        success: data.success,
        created: true,
        metadata: { operation: 'create_case' },
      },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Created case' },
  },
}

// Update Case
export const salesforceUpdateCaseTool: ToolConfig<any, any> = {
  id: 'salesforce_update_case',
  name: 'Update Case in Salesforce',
  description: 'Update an existing case',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    caseId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Case ID (required)',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Case subject',
    },
    status: { type: 'string', required: false, visibility: 'user-only', description: 'Status' },
    priority: { type: 'string', required: false, visibility: 'user-only', description: 'Priority' },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Case/${params.caseId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.subject) body.Subject = params.subject
      if (params.status) body.Status = params.status
      if (params.priority) body.Priority = params.priority
      if (params.description) body.Description = params.description
      return body
    },
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data[0]?.message || data.message || 'Failed to update case')
    }
    return {
      success: true,
      output: { id: params.caseId, updated: true, metadata: { operation: 'update_case' } },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Updated case' },
  },
}

// Delete Case
export const salesforceDeleteCaseTool: ToolConfig<any, any> = {
  id: 'salesforce_delete_case',
  name: 'Delete Case from Salesforce',
  description: 'Delete a case',
  version: '1.0.0',
  oauth: { required: true, provider: 'salesforce' },
  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    caseId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Case ID (required)',
    },
  },
  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Case/${params.caseId}`,
    method: 'DELETE',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data[0]?.message || data.message || 'Failed to delete case')
    }
    return {
      success: true,
      output: { id: params.caseId, deleted: true, metadata: { operation: 'delete_case' } },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Deleted case' },
  },
}
