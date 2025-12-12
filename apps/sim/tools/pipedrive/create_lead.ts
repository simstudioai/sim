import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveCreateLeadParams,
  PipedriveCreateLeadResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveCreateLead')

export const pipedriveCreateLeadTool: ToolConfig<
  PipedriveCreateLeadParams,
  PipedriveCreateLeadResponse
> = {
  id: 'pipedrive_create_lead',
  name: 'Create Lead in Pipedrive',
  description: 'Create a new lead in Pipedrive',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The name of the lead',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the person (REQUIRED unless organization_id is provided)',
    },
    organization_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the organization (REQUIRED unless person_id is provided)',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the user who will own the lead',
    },
    value_amount: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Potential value amount',
    },
    value_currency: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Currency code (e.g., USD, EUR)',
    },
    expected_close_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Expected close date in YYYY-MM-DD format',
    },
    visible_to: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Visibility: 1 (Owner & followers), 3 (Entire company)',
    },
  },

  request: {
    url: () => 'https://api.pipedrive.com/v1/leads',
    method: 'POST',
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
      if (!params.person_id && !params.organization_id) {
        throw new Error('Either person_id or organization_id is required to create a lead')
      }

      const body: Record<string, any> = {
        title: params.title,
      }

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
      if (params.visible_to) body.visible_to = Number(params.visible_to)

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to create lead in Pipedrive')
    }

    return {
      success: true,
      output: {
        lead: data.data,
        metadata: {
          operation: 'create_lead' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created lead details',
      properties: {
        lead: {
          type: 'object',
          description: 'The created lead object',
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
