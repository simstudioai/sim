import type { TypeformCreateFormParams, TypeformCreateFormResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

export const createFormTool: ToolConfig<TypeformCreateFormParams, TypeformCreateFormResponse> = {
  id: 'typeform_create_form',
  name: 'Typeform Create Form',
  description: 'Create a new form with fields and settings',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Typeform Personal Access Token',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Form title',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Form type (default: "form"). Options: "form", "quiz"',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Workspace ID to create the form in',
    },
    fields: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description:
        'Array of field objects defining the form structure. Each field needs: type, title, and optional properties/validations',
    },
    settings: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Form settings object (language, progress_bar, etc.)',
    },
    themeId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Theme ID to apply to the form',
    },
  },

  request: {
    url: () => 'https://api.typeform.com/forms',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: TypeformCreateFormParams) => {
      const body: any = {
        title: params.title,
      }

      if (params.type) {
        body.type = params.type
      }

      if (params.workspaceId) {
        body.workspace = {
          href: `https://api.typeform.com/workspaces/${params.workspaceId}`,
        }
      }

      if (params.fields) {
        body.fields = params.fields
      }

      if (params.settings) {
        body.settings = params.settings
      }

      if (params.themeId) {
        body.theme = {
          href: `https://api.typeform.com/themes/${params.themeId}`,
        }
      }

      return body
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
      description: 'Created form unique identifier',
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
      description: 'Applied theme configuration',
    },
    workspace: {
      type: 'object',
      description: 'Workspace information',
    },
    fields: {
      type: 'array',
      description: 'Array of created form fields',
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
