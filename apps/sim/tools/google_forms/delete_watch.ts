import type {
  GoogleFormsDeleteWatchParams,
  GoogleFormsDeleteWatchResponse,
} from '@/tools/google_forms/types'
import { buildDeleteWatchUrl } from '@/tools/google_forms/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteWatchTool: ToolConfig<
  GoogleFormsDeleteWatchParams,
  GoogleFormsDeleteWatchResponse
> = {
  id: 'google_forms_delete_watch',
  name: 'Google Forms: Delete Watch',
  description: 'Delete a notification watch from a form',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-forms',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Forms form ID',
    },
    watchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Watch ID to delete',
    },
  },

  request: {
    url: (params: GoogleFormsDeleteWatchParams) =>
      buildDeleteWatchUrl(params.formId, params.watchId),
    method: 'DELETE',
    headers: (params: GoogleFormsDeleteWatchParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } }
      return {
        success: false,
        output: {
          deleted: false,
        },
        error: data.error?.message ?? 'Failed to delete watch',
      }
    }

    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the watch was successfully deleted' },
  },
}
