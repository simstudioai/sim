import type {
  GoogleFormsPublishSettings,
  GoogleFormsSetPublishSettingsParams,
  GoogleFormsSetPublishSettingsResponse,
} from '@/tools/google_forms/types'
import { buildSetPublishSettingsUrl } from '@/tools/google_forms/utils'
import type { ToolConfig } from '@/tools/types'

interface SetPublishSettingsApiResponse {
  formId?: string
  publishSettings?: GoogleFormsPublishSettings
}

export const setPublishSettingsTool: ToolConfig<
  GoogleFormsSetPublishSettingsParams,
  GoogleFormsSetPublishSettingsResponse
> = {
  id: 'google_forms_set_publish_settings',
  name: 'Google Forms: Set Publish Settings',
  description: 'Update the publish settings of a form (publish/unpublish, accept responses)',
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
    isPublished: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether the form is published and visible to others',
    },
    isAcceptingResponses: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the form accepts responses (forced to false if isPublished is false)',
    },
  },

  request: {
    url: (params: GoogleFormsSetPublishSettingsParams) => buildSetPublishSettingsUrl(params.formId),
    method: 'POST',
    headers: (params: GoogleFormsSetPublishSettingsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleFormsSetPublishSettingsParams) => ({
      publishSettings: {
        publishState: {
          isPublished: params.isPublished,
          ...(params.isAcceptingResponses !== undefined
            ? { isAcceptingResponses: params.isAcceptingResponses }
            : {}),
        },
      },
      updateMask: 'publishState',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as SetPublishSettingsApiResponse

    if (!response.ok) {
      const errorData = data as unknown as { error?: { message?: string } }
      return {
        success: false,
        output: {
          formId: '',
          publishSettings: {},
        },
        error: errorData.error?.message ?? 'Failed to set publish settings',
      }
    }

    return {
      success: true,
      output: {
        formId: data.formId ?? '',
        publishSettings: data.publishSettings ?? {},
      },
    }
  },

  outputs: {
    formId: { type: 'string', description: 'The form ID' },
    publishSettings: {
      type: 'json',
      description: 'The updated publish settings',
      properties: {
        publishState: {
          type: 'object',
          description: 'The publish state',
          properties: {
            isPublished: { type: 'boolean', description: 'Whether the form is published' },
            isAcceptingResponses: {
              type: 'boolean',
              description: 'Whether the form accepts responses',
            },
          },
        },
      },
    },
  },
}
