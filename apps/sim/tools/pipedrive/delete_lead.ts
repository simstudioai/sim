import { createLogger } from '@sim/logger'
import type {
  PipedriveDeleteLeadParams,
  PipedriveDeleteLeadResponse,
} from '@/tools/pipedrive/types'
import { getPipedriveAuthHeaders } from '@/tools/pipedrive/utils'
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
    authStyle: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Auth scheme for the token; set by the credential resolver for API-token service accounts',
    },
    lead_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the lead to delete (e.g., "abc123-def456-ghi789")',
    },
  },

  request: {
    url: (params) => `https://api.pipedrive.com/v1/leads/${params.lead_id}`,
    method: 'DELETE',
    headers: (params) => getPipedriveAuthHeaders(params),
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
        data: data.data ?? null,
        success: true,
      },
    }
  },

  outputs: {
    data: { type: 'object', description: 'Deletion confirmation data', optional: true },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
