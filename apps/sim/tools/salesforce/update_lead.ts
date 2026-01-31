import type {
  SalesforceUpdateLeadParams,
  SalesforceUpdateLeadResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_UPDATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceUpdateLeadTool: ToolConfig<
  SalesforceUpdateLeadParams,
  SalesforceUpdateLeadResponse
> = {
  id: 'salesforce_update_lead',
  name: 'Update Lead in Salesforce',
  description: 'Update an existing lead',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Salesforce Lead ID to update (18-character string starting with 00Q)',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead status (e.g., Open, Working, Closed)',
    },
    leadSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead source (e.g., Web, Referral, Campaign)',
    },
    title: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Job title' },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lead description',
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

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data[0]?.message || data.message || 'Failed to update lead')
    }
    return {
      success: true,
      output: {
        id: params?.leadId || '',
        updated: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated lead data',
      properties: SOBJECT_UPDATE_OUTPUT_PROPERTIES,
    },
  },
}
