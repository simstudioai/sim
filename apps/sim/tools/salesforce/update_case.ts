import type {
  SalesforceUpdateCaseParams,
  SalesforceUpdateCaseResponse,
} from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceUpdateCaseTool: ToolConfig<
  SalesforceUpdateCaseParams,
  SalesforceUpdateCaseResponse
> = {
  id: 'salesforce_update_case',
  name: 'Update Case in Salesforce',
  description: 'Update an existing case',
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
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Status',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Priority',
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

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data[0]?.message || data.message || 'Failed to update case')
    }
    return {
      success: true,
      output: {
        id: params?.caseId || '',
        updated: true,
        metadata: { operation: 'update_case' },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Updated case' },
  },
}
