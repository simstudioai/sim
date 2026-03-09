import type { DeleteTemplateParams } from '@/tools/sendgrid/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const sendGridDeleteTemplateTool: ToolConfig<DeleteTemplateParams, ToolResponse> = {
  id: 'sendgrid_delete_template',
  name: 'SendGrid Delete Template',
  description: 'Delete an email template from SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    templateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Template ID to delete',
    },
  },

  request: {
    url: (params) => `https://api.sendgrid.com/v3/templates/${params.templateId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ToolResponse> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to delete template')
    }

    return {
      success: true,
      output: {},
    }
  },

  outputs: {},
}
