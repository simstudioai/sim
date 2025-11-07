import { createLogger } from '@/lib/logs/console/logger'
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
      visibility: 'user-only',
      description: 'The title of the deal',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The monetary value of the deal',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Currency code (e.g., USD, EUR)',
    },
    person_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the person this deal is associated with',
    },
    org_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the organization this deal is associated with',
    },
    pipeline_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the pipeline this deal should be placed in',
    },
    stage_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ID of the stage this deal should be placed in',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Status of the deal: open, won, lost',
    },
    expected_close_date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Expected close date in YYYY-MM-DD format',
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
        deal: data.data,
        metadata: {
          operation: 'create_deal' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created deal details',
      properties: {
        deal: {
          type: 'object',
          description: 'The created deal object',
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
