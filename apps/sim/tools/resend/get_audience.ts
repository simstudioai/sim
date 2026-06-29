import { createLogger } from '@sim/logger'
import type { GetAudienceParams, GetAudienceResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendGetAudienceTool')

export const resendGetAudienceTool: ToolConfig<GetAudienceParams, GetAudienceResult> = {
  id: 'resend_get_audience',
  name: 'Get Audience',
  description: 'Retrieve details of an audience by ID',
  version: '1.0.0',

  params: {
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the audience to retrieve',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: GetAudienceParams) =>
      `https://api.resend.com/audiences/${encodeURIComponent(params.audienceId.trim())}`,
    method: 'GET',
    headers: (params: GetAudienceParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GetAudienceResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Get Audience API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to retrieve audience',
        output: {
          id: '',
          name: '',
          createdAt: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name ?? '',
        createdAt: data.created_at ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Audience ID' },
    name: { type: 'string', description: 'Audience name' },
    createdAt: { type: 'string', description: 'Audience creation timestamp' },
  },
}
