import type {
  GoogleForm,
  GoogleFormsGetFormParams,
  GoogleFormsGetFormResponse,
} from '@/tools/google_forms/types'
import { buildGetFormUrl } from '@/tools/google_forms/utils'
import type { ToolConfig } from '@/tools/types'

export const getFormTool: ToolConfig<GoogleFormsGetFormParams, GoogleFormsGetFormResponse> = {
  id: 'google_forms_get_form',
  name: 'Google Forms: Get Form',
  description: 'Retrieve a form structure including its items, settings, and metadata',
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
      description: 'Google Forms form ID to retrieve',
    },
  },

  request: {
    url: (params: GoogleFormsGetFormParams) => buildGetFormUrl(params.formId),
    method: 'GET',
    headers: (params: GoogleFormsGetFormParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as GoogleForm

    if (!response.ok) {
      const errorData = data as unknown as { error?: { message?: string } }
      return {
        success: false,
        output: {
          formId: '',
          title: null,
          description: null,
          documentTitle: null,
          responderUri: null,
          linkedSheetId: null,
          revisionId: null,
          items: [],
          settings: null,
          publishSettings: null,
        },
        error: errorData.error?.message ?? 'Failed to get form',
      }
    }

    return {
      success: true,
      output: {
        formId: data.formId ?? '',
        title: data.info?.title ?? null,
        description: data.info?.description ?? null,
        documentTitle: data.info?.documentTitle ?? null,
        responderUri: data.responderUri ?? null,
        linkedSheetId: data.linkedSheetId ?? null,
        revisionId: data.revisionId ?? null,
        items: data.items ?? [],
        settings: data.settings ?? null,
        publishSettings: data.publishSettings ?? null,
      },
    }
  },

  outputs: {
    formId: { type: 'string', description: 'The form ID' },
    title: { type: 'string', description: 'The form title visible to responders', optional: true },
    description: { type: 'string', description: 'The form description', optional: true },
    documentTitle: {
      type: 'string',
      description: 'The document title visible in Drive',
      optional: true,
    },
    responderUri: {
      type: 'string',
      description: 'The URI to share with responders',
      optional: true,
    },
    linkedSheetId: {
      type: 'string',
      description: 'The ID of the linked Google Sheet',
      optional: true,
    },
    revisionId: { type: 'string', description: 'The revision ID of the form', optional: true },
    items: {
      type: 'array',
      description: 'The form items (questions, sections, etc.)',
      items: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Item ID' },
          title: { type: 'string', description: 'Item title' },
          description: { type: 'string', description: 'Item description' },
        },
      },
    },
    settings: { type: 'json', description: 'Form settings', optional: true },
    publishSettings: { type: 'json', description: 'Form publish settings', optional: true },
  },
}
