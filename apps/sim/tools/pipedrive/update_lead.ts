import { createLogger } from '@sim/logger'
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
      visibility: 'user-or-llm',
      description: 'The ID of the lead to update (e.g., "abc123-def456-ghi789")',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the lead (e.g., "Updated Lead - Premium Package")',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New person ID (e.g., "456")',
    },
    organization_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New organization ID (e.g., "789")',
    },
    owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New owner user ID (e.g., "123")',
    },
    value_amount: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New value amount (e.g., "15000")',
    },
    value_currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New currency code (e.g., "USD", "EUR", "GBP")',
    },
    expected_close_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New expected close date in YYYY-MM-DD format (e.g., "2025-05-01")',
    },
    is_archived: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
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
        lead: data.data ?? null,
        success: true,
      },
    }
  },

  outputs: {
    lead: { type: 'object', description: 'The updated lead object', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
