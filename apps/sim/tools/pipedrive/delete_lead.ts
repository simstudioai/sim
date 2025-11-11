import { createLogger } from '@/lib/logs/console/logger'
import type {
  PipedriveDeleteLeadParams,
  PipedriveDeleteLeadResponse,
} from '@/tools/pipedrive/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('PipedriveDeleteLead')

export const pipedriveDeleteLeadTool: ToolConfig<
  PipedriveDeleteLeadParams,
  PipedriveDeleteLeadResponse
> = {
  id: 'pipedrive_delete_lead',
  name: 'Delete Lead from Pipedrive',
  description: 'Delete a specific lead from Pipedrive',
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
      description: 'The ID of the lead to delete',
    },
  },

  request: {
    url: (params) => `https://api.pipedrive.com/v1/leads/${params.lead_id}`,
    method: 'DELETE',
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
      throw new Error(data.error || 'Failed to delete lead from Pipedrive')
    }

    return {
      success: true,
      output: {
        data: data.data,
        metadata: {
          operation: 'delete_lead' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deletion result',
      properties: {
        data: {
          type: 'object',
          description: 'Deletion confirmation data',
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
