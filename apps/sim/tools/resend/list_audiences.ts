import { createLogger } from '@sim/logger'
import type { ListAudiencesParams, ListAudiencesResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendListAudiencesTool')

export const resendListAudiencesTool: ToolConfig<ListAudiencesParams, ListAudiencesResult> = {
  id: 'resend_list_audiences',
  name: 'List Audiences',
  description: 'List all audiences in Resend',
  version: '1.0.0',

  params: {
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: 'https://api.resend.com/audiences',
    method: 'GET',
    headers: (params: ListAudiencesParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<ListAudiencesResult> => {
    const data = await response.json()

    if (data.message) {
      logger.error('Resend List Audiences API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to list audiences',
        output: {
          audiences: [],
          hasMore: false,
        },
      }
    }

    return {
      success: true,
      output: {
        audiences: data.data ?? [],
        hasMore: data.has_more ?? false,
      },
    }
  },

  outputs: {
    audiences: {
      type: 'array',
      description: 'Array of audiences',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Audience ID' },
          name: { type: 'string', description: 'Audience name' },
          created_at: { type: 'string', description: 'Audience creation timestamp' },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether there are more audiences to retrieve' },
  },
}
