import type {
  SalesforceCreateCaseParams,
  SalesforceCreateCaseResponse,
} from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceCreateCaseTool: ToolConfig<
  SalesforceCreateCaseParams,
  SalesforceCreateCaseResponse
> = {
  id: 'salesforce_create_case',
  name: 'Create Case in Salesforce',
  description: 'Create a new case',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
    },
    idToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
    instanceUrl: {
      type: 'string',
      required: false,
      visibility: 'hidden',
    },
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
