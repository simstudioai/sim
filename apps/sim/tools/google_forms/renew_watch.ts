import type {
  GoogleFormsRenewWatchParams,
  GoogleFormsRenewWatchResponse,
  GoogleFormsWatch,
} from '@/tools/google_forms/types'
import { buildRenewWatchUrl, getGoogleFormsErrorMessage } from '@/tools/google_forms/utils'
import type { ToolConfig } from '@/tools/types'

export const renewWatchTool: ToolConfig<
  GoogleFormsRenewWatchParams,
  GoogleFormsRenewWatchResponse
> = {
  id: 'google_forms_renew_watch',
  name: 'Google Forms: Renew Watch',
  description: 'Renew a notification watch for another 7 days',
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
      description: 'Watch ID to renew',
    },
  },

  request: {
    url: (params: GoogleFormsRenewWatchParams) => buildRenewWatchUrl(params.formId, params.watchId),
    method: 'POST',
    headers: (params: GoogleFormsRenewWatchParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as GoogleFormsWatch

    if (!response.ok) {
      return {
        success: false,
        output: {
          id: '',
          eventType: null,
          expireTime: null,
          state: null,
        },
        error: getGoogleFormsErrorMessage(data, 'Failed to renew watch'),
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        eventType: data.eventType ?? null,
        expireTime: data.expireTime ?? null,
        state: data.state ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'The watch ID' },
    eventType: { type: 'string', description: 'The event type being watched', optional: true },
    expireTime: { type: 'string', description: 'The new expiration time', optional: true },
    state: { type: 'string', description: 'The watch state', optional: true },
  },
}
