import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveUpdateDealParams,
  PipedriveUpdateDealResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveUpdateDeal')

export const pipedriveUpdateDealTool: ToolConfig<
  PipedriveUpdateDealParams,
  PipedriveUpdateDealResponse
> = {
  id: 'pipedrive_update_deal',
  name: 'Update Deal in Pipedrive',
  description: 'Update an existing deal in Pipedrive',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Pipedrive API',
    },
    deal_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the deal to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New title for the deal',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New monetary value for the deal',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New status: open, won, lost',
    },
    stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New stage ID for the deal',
    },
    expected_close_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New expected close date in YYYY-MM-DD format',
    },
  },

  request: {
    url: (params) => `https://api.pipedrive.com/api/v2/deals/${params.deal_id}`,
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
      if (params.value) body.value = Number(params.value)
      if (params.status) body.status = params.status
      if (params.stage_id) body.stage_id = Number(params.stage_id)
      if (params.expected_close_date) body.expected_close_date = params.expected_close_date

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to update deal in Pipedrive')
    }

    return {
      success: true,
      output: {
        deal: data.data,
        metadata: {
          operation: 'update_deal' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated deal details',
      properties: {
        deal: {
          type: 'object',
          description: 'The updated deal object',
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
