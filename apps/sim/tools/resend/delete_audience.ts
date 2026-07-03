import { createLogger } from '@sim/logger'
import type { DeleteAudienceParams, DeleteAudienceResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendDeleteAudienceTool')

export const resendDeleteAudienceTool: ToolConfig<DeleteAudienceParams, DeleteAudienceResult> = {
  id: 'resend_delete_audience',
  name: 'Delete Audience',
  description: 'Delete an audience from Resend by ID',
  version: '1.0.0',

  params: {
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the audience to delete',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: DeleteAudienceParams) =>
      `https://api.resend.com/audiences/${encodeURIComponent(params.audienceId.trim())}`,
    method: 'DELETE',
    headers: (params: DeleteAudienceParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<DeleteAudienceResult> => {
    const data = await response.json()

    if (data.message && !data.deleted) {
      logger.error('Resend Delete Audience API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to delete audience',
        output: {
          id: '',
          deleted: false,
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        deleted: data.deleted ?? true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deleted audience ID' },
    deleted: { type: 'boolean', description: 'Whether the audience was successfully deleted' },
  },
}
