import type {
  GoogleFormsListWatchesParams,
  GoogleFormsListWatchesResponse,
  GoogleFormsWatch,
} from '@/tools/google_forms/types'
import { buildListWatchesUrl } from '@/tools/google_forms/utils'
import type { ToolConfig } from '@/tools/types'

interface ListWatchesApiResponse {
  watches?: GoogleFormsWatch[]
}

export const listWatchesTool: ToolConfig<
  GoogleFormsListWatchesParams,
  GoogleFormsListWatchesResponse
> = {
  id: 'google_forms_list_watches',
  name: 'Google Forms: List Watches',
  description: 'List all notification watches for a form',
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
  },

  request: {
    url: (params: GoogleFormsListWatchesParams) => buildListWatchesUrl(params.formId),
    method: 'GET',
    headers: (params: GoogleFormsListWatchesParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as ListWatchesApiResponse

    if (!response.ok) {
      const errorData = data as unknown as { error?: { message?: string } }
      return {
        success: false,
        output: {
          watches: [],
        },
        error: errorData.error?.message ?? 'Failed to list watches',
      }
    }

    const watches = (data.watches ?? []).map((watch) => ({
      id: watch.id,
      target: watch.target,
      eventType: watch.eventType,
      createTime: watch.createTime,
      expireTime: watch.expireTime,
      state: watch.state,
      errorType: watch.errorType,
    }))

    return {
      success: true,
      output: {
        watches,
      },
    }
  },

  outputs: {
    watches: {
      type: 'array',
      description: 'List of watches for the form',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Watch ID' },
          eventType: { type: 'string', description: 'Event type (SCHEMA or RESPONSES)' },
          createTime: { type: 'string', description: 'When the watch was created' },
          expireTime: { type: 'string', description: 'When the watch expires' },
          state: { type: 'string', description: 'Watch state' },
        },
      },
    },
  },
}
