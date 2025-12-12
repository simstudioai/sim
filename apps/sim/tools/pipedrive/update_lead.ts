import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveUpdateLeadParams,
  PipedriveUpdateLeadResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveUpdateLead')

export const pipedriveUpdateLeadTool: ToolConfig<
  PipedriveUpdateLeadParams,
  PipedriveUpdateLeadResponse
> = {
  id: 'pipedrive_update_lead',
  name: 'Update Lead in Pipedrive',
  description: 'Update an existing lead in Pipedrive',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'pipedrive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    lead_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the lead to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New name for the lead',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New person ID',
    },
    organization_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New organization ID',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New owner user ID',
    },
    value_amount: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New value amount',
    },
    value_currency: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New currency code (e.g., USD, EUR)',
    },
    expected_close_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New expected close date in YYYY-MM-DD format',
    },
    is_archived: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Archive the lead: true or false',
    },
  },

  request: {
    url: (params) => `https://api.pipedrive.com/v1/leads/${params.lead_id}`,
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.title) body.title = params.title
      if (params.person_id) body.person_id = Number(params.person_id)
      if (params.organization_id) body.organization_id = Number(params.organization_id)
      if (params.owner_id) body.owner_id = Number(params.owner_id)

      // Build value object if both amount and currency are provided
      if (params.value_amount && params.value_currency) {
        body.value = {
          amount: Number(params.value_amount),
          currency: params.value_currency,
        }
      }

      if (params.expected_close_date) body.expected_close_date = params.expected_close_date
      if (params.is_archived) body.is_archived = params.is_archived === 'true'

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to update lead in Pipedrive')
    }

    return {
      success: true,
      output: {
        lead: data.data,
        metadata: {
          operation: 'update_lead' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated lead details',
      properties: {
        lead: {
          type: 'object',
          description: 'The updated lead object',
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
        },
        success: { type: 'boolean', description: 'Operation success status' },
      },
    },
  },
}
