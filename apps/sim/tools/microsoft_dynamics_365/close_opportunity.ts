import { createLogger } from '@sim/logger'
import type {
  DataverseCloseOpportunityParams,
  DataverseCloseOpportunityResponse,
  DataverseOpportunityOutcome,
} from '@/tools/microsoft_dynamics_365/types'
import {
  getDataverseErrorMessage,
  getDynamics365BaseUrl,
  normalizeDataverseGuid,
  parseDataverseInt32,
  parseDataverseRequiredString,
} from '@/tools/microsoft_dynamics_365/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('DataverseCloseOpportunity')

function parseOpportunityOutcome(value: unknown): DataverseOpportunityOutcome {
  if (value !== 'won' && value !== 'lost') {
    throw new Error('outcome must be won or lost')
  }
  return value
}

export const microsoftDynamics365CloseOpportunityTool: ToolConfig<
  DataverseCloseOpportunityParams,
  DataverseCloseOpportunityResponse
> = {
  id: 'microsoft_dynamics_365_close_opportunity',
  name: 'Close Microsoft Dynamics 365 Opportunity',
  description: 'Close a Dynamics 365 Sales opportunity as won or lost.',
  version: '1.0.0',

  oauth: { required: true, provider: 'microsoft-dataverse' },
  errorExtractor: 'nested-error-object',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Microsoft Dataverse API',
    },
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Trusted Dynamics 365 environment bound to the selected OAuth credential',
    },
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynamics 365 environment URL (e.g., https://myorg.crm.dynamics.com)',
    },
    opportunityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GUID of the opportunity to close',
    },
    outcome: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Opportunity outcome: won or lost',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Subject for the opportunity-close activity (maximum 200 characters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional description for the opportunity-close activity',
    },
    statusReason: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opportunity status-reason value (defaults to 3 for won or 4 for lost)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = getDynamics365BaseUrl(params.environmentUrl, params.instanceUrl)
      const outcome = parseOpportunityOutcome(params.outcome)
      return `${baseUrl}/api/data/v9.2/${outcome === 'won' ? 'WinOpportunity' : 'LoseOpportunity'}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      Accept: 'application/json',
    }),
    body: (params) => {
      const opportunityId = normalizeDataverseGuid(params.opportunityId, 'opportunityId')
      const outcome = parseOpportunityOutcome(params.outcome)
      const subject = parseDataverseRequiredString(params.subject, 'subject', 200)
      const status =
        params.statusReason === undefined
          ? outcome === 'won'
            ? 3
            : 4
          : parseDataverseInt32(params.statusReason, 'statusReason')
      const opportunityClose: Record<string, unknown> = {
        'opportunityid@odata.bind': `/opportunities(${opportunityId})`,
        subject,
      }
      if (params.description !== undefined) {
        if (typeof params.description !== 'string') {
          throw new Error('description must be a string')
        }
        opportunityClose.description = params.description
      }

      return {
        OpportunityClose: opportunityClose,
        Status: status,
      }
    },
  },

  transformResponse: async (response: Response, params?: DataverseCloseOpportunityParams) => {
    if (!response.ok) {
      const errorMessage = await getDataverseErrorMessage(response)
      logger.error('Dataverse close opportunity failed', { status: response.status })
      throw new Error(errorMessage)
    }
    if (response.status !== 204) {
      throw new Error(
        `Invalid Dataverse close opportunity response: expected HTTP 204, received ${response.status}`
      )
    }
    if (!params) {
      throw new Error('Missing Dataverse close opportunity response context')
    }

    return {
      success: true,
      output: {
        opportunityId: normalizeDataverseGuid(params.opportunityId, 'opportunityId'),
        outcome: parseOpportunityOutcome(params.outcome),
        success: true,
      },
    }
  },

  outputs: {
    opportunityId: { type: 'string', description: 'GUID of the closed opportunity' },
    outcome: { type: 'string', description: 'The applied opportunity outcome: won or lost' },
    success: { type: 'boolean', description: 'Whether the opportunity was closed successfully' },
  },
}
