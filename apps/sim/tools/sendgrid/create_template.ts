import type { CreateTemplateParams, SendGridTemplate, TemplateResult } from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridCreateTemplateTool: ToolConfig<CreateTemplateParams, TemplateResult> = {
  id: 'sendgrid_create_template',
  name: 'SendGrid Create Template',
  description: 'Create a new email template in SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Template name',
    },
    generation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Template generation type (legacy or dynamic, default: dynamic)',
    },
  },

  request: {
    url: () => 'https://api.sendgrid.com/v3/templates',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        body: JSON.stringify({
          name: params.name,
          generation: params.generation || 'dynamic',
        }),
      }
    },
  },

  transformResponse: async (response): Promise<TemplateResult> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to create template')
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
