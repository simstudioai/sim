import type {
  SalesforceCreateOpportunityParams,
  SalesforceCreateOpportunityResponse,
} from '@/tools/salesforce/types'
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
      visibility: 'user-only',
      description: 'Opportunity name (required)',
    },
    stageName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stage name (required)',
    },
    closeDate: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Close date YYYY-MM-DD (required)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID',
    },
    amount: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Amount (number)',
    },
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
        metadata: { operation: 'create_opportunity' },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Success' },
    output: { type: 'object', description: 'Created opportunity' },
  },
}
