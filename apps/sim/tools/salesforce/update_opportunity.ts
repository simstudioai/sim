import type {
  SalesforceUpdateOpportunityParams,
  SalesforceUpdateOpportunityResponse,
} from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceUpdateOpportunityTool: ToolConfig<
  SalesforceUpdateOpportunityParams,
  SalesforceUpdateOpportunityResponse
> = {
  id: 'salesforce_update_opportunity',
  name: 'Update Opportunity in Salesforce',
  description: 'Update an existing opportunity',
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

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data[0]?.message || data.message || 'Failed to update opportunity')
    }
    return {
      success: true,
      output: {
        id: params?.opportunityId || '',
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
