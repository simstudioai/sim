import type { GetTemplateParams, SendGridTemplate, TemplateResult } from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridGetTemplateTool: ToolConfig<GetTemplateParams, TemplateResult> = {
  id: 'sendgrid_get_template',
  name: 'SendGrid Get Template',
  description: 'Get a specific template by ID from SendGrid',
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
      description: 'Template ID',
    },
  },

  request: {
    url: (params) => `https://api.sendgrid.com/v3/templates/${params.templateId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<TemplateResult> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to get template')
    }

    const data = (await response.json()) as SendGridTemplate

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        generation: data.generation,
        updatedAt: data.updated_at,
        versions: data.versions || [],
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Template ID' },
    name: { type: 'string', description: 'Template name' },
    generation: { type: 'string', description: 'Template generation' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    versions: { type: 'json', description: 'Array of template versions' },
  },
}
