import type { TypeformGetFormParams, TypeformGetFormResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

export const getFormTool: ToolConfig<TypeformGetFormParams, TypeformGetFormResponse> = {
  id: 'typeform_get_form',
  name: 'Typeform Get Form',
  description: 'Retrieve complete details and structure of a specific form',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform Personal Access Token',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Form unique identifier (e.g., "abc123XYZ")',
    },
  },

  request: {
    url: (params: TypeformGetFormParams) => {
      return `https://api.typeform.com/forms/${params.formId}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        ...data,
        welcome_screens: data.welcome_screens || [],
        thankyou_screens: data.thankyou_screens || [],
        fields: data.fields || [],
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Form unique identifier',
    },
    title: {
      type: 'string',
      description: 'Form title',
    },
    type: {
      type: 'string',
      description: 'Form type (form, quiz, etc.)',
    },
    settings: {
      type: 'object',
      description: 'Form settings including language, progress bar, etc.',
    },
    theme: {
      type: 'object',
      description: 'Theme reference',
    },
    workspace: {
      type: 'object',
      description: 'Workspace reference',
    },
    fields: {
      type: 'array',
      description: 'Array of form fields/questions',
    },
    welcome_screens: {
      type: 'array',
      description: 'Array of welcome screens (empty if none configured)',
    },
    thankyou_screens: {
      type: 'array',
      description: 'Array of thank you screens',
    },
    created_at: {
      type: 'string',
      description: 'Form creation timestamp (ISO 8601 format)',
    },
    last_updated_at: {
      type: 'string',
      description: 'Form last update timestamp (ISO 8601 format)',
    },
    published_at: {
      type: 'string',
      description: 'Form publication timestamp (ISO 8601 format)',
    },
    _links: {
      type: 'object',
      description: 'Related resource links including public form URL',
    },
  },
}
