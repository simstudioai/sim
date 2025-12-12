import type { TypeformUpdateFormParams, TypeformUpdateFormResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

export const updateFormTool: ToolConfig<TypeformUpdateFormParams, TypeformUpdateFormResponse> = {
  id: 'typeform_update_form',
  name: 'Typeform Update Form',
  description: 'Update an existing form using JSON Patch operations',
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
      description: 'Form unique identifier to update',
    },
    operations: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description:
        'Array of JSON Patch operations (RFC 6902). Each operation needs: op (add/remove/replace), path, and value (for add/replace)',
    },
  },

  request: {
    url: (params: TypeformUpdateFormParams) => {
      return `https://api.typeform.com/forms/${params.formId}`
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: TypeformUpdateFormParams) => {
      return params.operations
    },
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
      description: 'Updated form unique identifier',
    },
    title: {
      type: 'string',
      description: 'Form title',
    },
    type: {
      type: 'string',
      description: 'Form type',
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
      description: 'Form settings',
    },
    theme: {
      type: 'object',
      description: 'Theme configuration',
    },
    workspace: {
      type: 'object',
      description: 'Workspace information',
    },
    fields: {
      type: 'array',
      description: 'Array of form fields',
    },
    thankyou_screens: {
      type: 'array',
      description: 'Array of thank you screens',
    },
    _links: {
      type: 'object',
      description: 'Related resource links',
    },
  },
}
