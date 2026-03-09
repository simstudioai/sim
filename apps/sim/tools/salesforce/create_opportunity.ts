import type {
  SalesforceCreateOpportunityParams,
  SalesforceCreateOpportunityResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_CREATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { getInstanceUrl } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

export const salesforceCreateOpportunityTool: ToolConfig<
  SalesforceCreateOpportunityParams,
  SalesforceCreateOpportunityResponse
> = {
  id: 'salesforce_create_opportunity',
  name: 'Create Opportunity in Salesforce',
  description: 'Create a new opportunity',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'salesforce',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    idToken: { type: 'string', required: false, visibility: 'hidden' },
    instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Opportunity name (required)',
    },
    stageName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stage name (required, e.g., Prospecting, Qualification, Closed Won)',
    },
    closeDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Close date in YYYY-MM-DD format (required)',
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
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created opportunity data',
      properties: SOBJECT_CREATE_OUTPUT_PROPERTIES,
    },
  },
}
