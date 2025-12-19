import type {
  SalesforceCreateLeadParams,
  SalesforceCreateLeadResponse,
} from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceCreateLeadTool: ToolConfig<
  SalesforceCreateLeadParams,
  SalesforceCreateLeadResponse
> = {
  id: 'salesforce_create_lead',
  name: 'Create Lead in Salesforce',
  description: 'Create a new lead',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

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
