import type {
  SalesforceUpdateOpportunityParams,
  SalesforceUpdateOpportunityResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_UPDATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
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
      visibility: 'user-or-llm',
      description: 'Salesforce Opportunity ID to update (18-character string starting with 006)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opportunity name',
    },
    stageName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stage name (e.g., Prospecting, Qualification, Closed Won)',
    },
    closeDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Close date in YYYY-MM-DD format',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Salesforce Account ID (18-character string starting with 001)',
    },
    amount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deal amount as a number',
    },
    probability: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Win probability as integer (0-100)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opportunity description',
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
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated opportunity data',
      properties: SOBJECT_UPDATE_OUTPUT_PROPERTIES,
    },
  },
}
