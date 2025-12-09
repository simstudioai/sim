import type { ToolConfig } from '@/tools/types'
import type { ZapierDeleteAiActionParams, ZapierDeleteAiActionResponse } from '@/tools/zapier/types'

export const zapierDeleteAiActionTool: ToolConfig<
  ZapierDeleteAiActionParams,
  ZapierDeleteAiActionResponse
> = {
  id: 'zapier_delete_action',
  name: 'Zapier Delete AI Action',
  description: 'Delete a stored AI Action from Zapier.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zapier AI Actions API key from actions.zapier.com/credentials',
    },
    actionId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the AI Action to delete',
    },
  },

  request: {
    url: (params) =>
      `https://actions.zapier.com/api/v2/ai-actions/${encodeURIComponent(params.actionId)}/`,
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    // DELETE returns a boolean directly
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.detail || `Zapier API error: ${response.status}`)
    }

    // API returns true if deleted, false if not found
    const deleted = data === true

    return {
      success: true,
      output: {
        deleted,
        message: deleted ? 'AI Action deleted successfully' : 'AI Action not found',
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the action was successfully deleted',
    },
    message: {
      type: 'string',
      description: 'Status message',
    },
  },
}
