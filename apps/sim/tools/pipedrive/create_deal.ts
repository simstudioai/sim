import { createLogger } from '@sim/logger'
import type {
  PipedriveCreateDealParams,
  PipedriveCreateDealResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveCreateDeal')

export const pipedriveCreateDealTool: ToolConfig<
  PipedriveCreateDealParams,
  PipedriveCreateDealResponse
> = {
  id: 'pipedrive_create_deal',
  name: 'Create Deal in Pipedrive',
  description: 'Create a new deal in Pipedrive',
  version: '1.0.0',

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
      visibility: 'user-or-llm',
      description: 'The title of the deal (e.g., "Enterprise Software License")',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The monetary value of the deal (e.g., "5000")',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Currency code (e.g., "USD", "EUR", "GBP")',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the person this deal is associated with (e.g., "456")',
    },
    org_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the organization this deal is associated with (e.g., "789")',
    },
    pipeline_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the pipeline this deal should be placed in (e.g., "1")',
    },
    stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the stage this deal should be placed in (e.g., "2")',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status of the deal: open, won, lost',
    },
    expected_close_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expected close date in YYYY-MM-DD format (e.g., "2025-06-30")',
    },
  },

  request: {
    url: () => 'https://api.pipedrive.com/api/v2/deals',
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
      const body: Record<string, any> = {
        title: params.title,
      }

      if (params.value) body.value = Number(params.value)
      if (params.currency) body.currency = params.currency
      if (params.person_id) body.person_id = Number(params.person_id)
      if (params.org_id) body.org_id = Number(params.org_id)
      if (params.pipeline_id) body.pipeline_id = Number(params.pipeline_id)
      if (params.stage_id) body.stage_id = Number(params.stage_id)
      if (params.status) body.status = params.status
      if (params.expected_close_date) body.expected_close_date = params.expected_close_date

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to create deal in Pipedrive')
    }

    return {
      success: true,
      output: {
        deal: data.data ?? null,
        success: true,
      },
    }
  },

  outputs: {
    deal: { type: 'object', description: 'The created deal object', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
