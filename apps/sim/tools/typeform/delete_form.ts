import type { TypeformDeleteFormParams, TypeformDeleteFormResponse } from '@/tools/typeform/types'
import type { ToolConfig } from '@/tools/types'

export const deleteFormTool: ToolConfig<TypeformDeleteFormParams, TypeformDeleteFormResponse> = {
  id: 'typeform_delete_form',
  name: 'Typeform Delete Form',
  description: 'Permanently delete a form and all its responses',
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
      description: 'Form unique identifier to delete',
    },
  },

  request: {
    url: (params: TypeformDeleteFormParams) => {
      return `https://api.typeform.com/forms/${params.formId}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (response.status === 204) {
      return {
        success: true,
        output: {
          deleted: true,
          message: 'Form successfully deleted',
        },
      }
    }

    const data = await response.json().catch(() => ({}))

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the form was successfully deleted',
    },
    message: {
      type: 'string',
      description: 'Deletion confirmation message',
    },
  },
}
