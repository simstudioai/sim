import { createLogger } from '@sim/logger'
import type {
  SalesforceUpdateOpportunityParams,
  SalesforceUpdateOpportunityResponse,
} from '@/tools/salesforce/types'
import { SOBJECT_UPDATE_OUTPUT_PROPERTIES } from '@/tools/salesforce/types'
import { extractErrorMessage, getInstanceUrl, requireId } from '@/tools/salesforce/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SalesforceUpdateOpportunity')

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
    url: (params) => {
      const opportunityId = requireId(params.opportunityId, 'Opportunity ID')
      return `${getInstanceUrl(params.idToken, params.instanceUrl)}/services/data/v59.0/sobjects/Opportunity/${opportunityId}`
    },
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
      if (params.accountId) body.AccountId = params.accountId.trim()
      if (params.amount) body.Amount = Number.parseFloat(params.amount)
      if (params.probability) body.Probability = Number.parseInt(params.probability)
      if (params.description) body.Description = params.description
      return body
    },
  },

  transformResponse: async (response, params?) => {
    if (!response.ok) {
      const data = await response.json()
      logger.error('Failed to update opportunity', { data, status: response.status })
      throw new Error(extractErrorMessage(data, response.status, 'Failed to update opportunity'))
    }
    return {
      success: true,
      output: {
        id: params?.opportunityId?.trim() || '',
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
