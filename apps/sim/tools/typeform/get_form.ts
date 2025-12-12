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
    created_at: {
      type: 'string',
      description: 'ISO timestamp of form creation',
    },
    last_updated_at: {
      type: 'string',
      description: 'ISO timestamp of last update',
    },
    settings: {
      type: 'object',
      description: 'Form settings including language, progress bar, etc.',
    },
    theme: {
      type: 'object',
      description: 'Theme configuration with colors, fonts, and design settings',
    },
    workspace: {
      type: 'object',
      description: 'Workspace information',
      properties: {
        href: { type: 'string', description: 'Workspace API URL' },
      },
    },
    fields: {
      type: 'array',
      description: 'Array of form fields/questions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Field unique identifier' },
          title: { type: 'string', description: 'Question text' },
          type: {
            type: 'string',
            description: 'Field type (short_text, email, multiple_choice, etc.)',
          },
          ref: { type: 'string', description: 'Field reference for webhooks/API' },
          properties: { type: 'object', description: 'Field-specific properties' },
          validations: { type: 'object', description: 'Validation rules' },
        },
      },
    },
    thankyou_screens: {
      type: 'array',
      description: 'Array of thank you screens',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Screen unique identifier' },
          title: { type: 'string', description: 'Thank you message' },
          ref: { type: 'string', description: 'Screen reference' },
          properties: { type: 'object', description: 'Screen properties' },
        },
      },
    },
    _links: {
      type: 'object',
      description: 'Related resource links',
      properties: {
        display: { type: 'string', description: 'Public form URL' },
        responses: { type: 'string', description: 'Responses API endpoint' },
      },
    },
  },
}
