import { createLogger } from '@/lib/logs/console/logger'
import type { PipedriveGetDealParams, PipedriveGetDealResponse } from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveGetDeal')

export const pipedriveGetDealTool: ToolConfig<PipedriveGetDealParams, PipedriveGetDealResponse> = {
  id: 'pipedrive_get_deal',
  name: 'Get Deal Details from Pipedrive',
  description: 'Retrieve detailed information about a specific deal',
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
      description: 'The ID of the deal to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.pipedrive.com/api/v2/deals/${params.deal_id}`,
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      logger.error('Pipedrive API request failed', { data })
      throw new Error(data.error || 'Failed to fetch deal from Pipedrive')
    }

    return {
      success: true,
      output: {
        deal: data.data,
        metadata: {
          operation: 'get_deal' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deal details',
      properties: {
        deal: {
          type: 'object',
          description: 'Deal object with full details',
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
