import type { ToolConfig } from '@/tools/types'
import { getInstanceUrl } from './utils'

export interface SalesforceDeleteCaseParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
  caseId: string
}

export interface SalesforceDeleteCaseResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_case'
    }
  }
}

export const salesforceDeleteCaseTool: ToolConfig<
  SalesforceDeleteCaseParams,
  SalesforceDeleteCaseResponse
> = {
  id: 'salesforce_delete_case',
  name: 'Delete Case from Salesforce',
  description: 'Delete a case',
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
  },

  request: {
    url: (params) =>
      `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Case/${params.caseId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data[0]?.message || data.message || 'Failed to delete case')
    }
    return {
      success: true,
      output: {
        id: params?.caseId || '',
        deleted: true,
        metadata: { operation: 'delete_case' },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Deleted case' },
  },
}
