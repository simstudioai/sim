import { createLogger } from '@sim/logger'
import type { CreateAudienceParams, CreateAudienceResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendCreateAudienceTool')

export const resendCreateAudienceTool: ToolConfig<CreateAudienceParams, CreateAudienceResult> = {
  id: 'resend_create_audience',
  name: 'Create Audience',
  description: 'Create a new audience in Resend',
  version: '1.0.0',

  params: {
    audienceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the audience to create',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: 'https://api.resend.com/audiences',
    method: 'POST',
    headers: (params: CreateAudienceParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: CreateAudienceParams) => ({
      name: params.audienceName,
    }),
  },

  transformResponse: async (response: Response): Promise<CreateAudienceResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Create Audience API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to create audience',
        output: {
          id: '',
          name: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created audience ID' },
    name: { type: 'string', description: 'Audience name' },
  },
}
