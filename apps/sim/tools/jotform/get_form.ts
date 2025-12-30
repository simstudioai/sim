import type { JotformGetFormParams, JotformGetFormResponse } from '@/tools/jotform/types'
import type { ToolConfig } from '@/tools/types'

export const getFormTool: ToolConfig<JotformGetFormParams, JotformGetFormResponse> = {
  id: 'jotform_get_form',
  name: 'Jotform Get Form',
  description: 'Retrieve form details from Jotform',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API Key',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform form ID',
    },
  },

  request: {
    url: (params: JotformGetFormParams) => {
      return `https://api.jotform.com/form/${params.formId}?apiKey=${encodeURIComponent(params.apiKey)}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data.content || {},
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Form ID',
    },
    title: {
      type: 'string',
      description: 'Form title',
    },
    status: {
      type: 'string',
      description: 'Form status',
    },
    created_at: {
      type: 'string',
      description: 'Form creation timestamp',
    },
    updated_at: {
      type: 'string',
      description: 'Form last update timestamp',
    },
    count: {
      type: 'string',
      description: 'Number of submissions',
    },
    url: {
      type: 'string',
      description: 'Form URL',
    },
  },
}
