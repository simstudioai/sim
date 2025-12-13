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
      visibility: 'user-only',
      description: 'Form unique identifier',
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
      output: data,
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
      description: 'Array of welcome screens',
    },
    thankyou_screens: {
      type: 'array',
      description: 'Array of thank you screens',
    },
    _links: {
      type: 'object',
      description: 'Related resource links including public form URL',
    },
  },
}
