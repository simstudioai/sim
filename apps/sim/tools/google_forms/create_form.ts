import type {
  GoogleForm,
  GoogleFormsCreateFormParams,
  GoogleFormsCreateFormResponse,
} from '@/tools/google_forms/types'
import { buildCreateFormUrl } from '@/tools/google_forms/utils'
import type { ToolConfig } from '@/tools/types'

export const createFormTool: ToolConfig<
  GoogleFormsCreateFormParams,
  GoogleFormsCreateFormResponse
> = {
  id: 'google_forms_create_form',
  name: 'Google Forms: Create Form',
  description: 'Create a new Google Form with a title',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the form visible to responders',
    },
    documentTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The document title visible in Drive (defaults to form title)',
    },
    unpublished: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If true, create an unpublished form that does not accept responses',
    },
  },

  request: {
    url: (params: GoogleFormsCreateFormParams) => buildCreateFormUrl(params.unpublished),
    method: 'POST',
    headers: (params: GoogleFormsCreateFormParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleFormsCreateFormParams) => ({
      info: {
        title: params.title,
        ...(params.documentTitle ? { documentTitle: params.documentTitle } : {}),
      },
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
          documentTitle: null,
          responderUri: null,
          revisionId: null,
        },
        error: errorData.error?.message ?? 'Failed to create form',
      }
    }

    return {
      success: true,
      output: {
        formId: data.formId ?? '',
        title: data.info?.title ?? null,
        documentTitle: data.info?.documentTitle ?? null,
        responderUri: data.responderUri ?? null,
        revisionId: data.revisionId ?? null,
      },
    }
  },

  outputs: {
    formId: { type: 'string', description: 'The ID of the created form' },
    title: { type: 'string', description: 'The form title', optional: true },
    documentTitle: { type: 'string', description: 'The document title in Drive', optional: true },
    responderUri: {
      type: 'string',
      description: 'The URI to share with responders',
      optional: true,
    },
    revisionId: { type: 'string', description: 'The revision ID of the form', optional: true },
  },
}
