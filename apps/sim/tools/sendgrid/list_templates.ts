import type { ListTemplatesParams, SendGridTemplate, TemplatesResult } from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridListTemplatesTool: ToolConfig<ListTemplatesParams, TemplatesResult> = {
  id: 'sendgrid_list_templates',
  name: 'SendGrid List Templates',
  description: 'Get all email templates from SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    generations: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by generation (legacy, dynamic, or both)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of templates to return per page (default: 20)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.sendgrid.com/v3/templates')
      if (params.generations) {
        url.searchParams.append('generations', params.generations)
      }
      if (params.pageSize) {
        url.searchParams.append('page_size', params.pageSize.toString())
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<TemplatesResult> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to list templates')
    }

    const data = (await response.json()) as {
      result?: SendGridTemplate[]
      templates?: SendGridTemplate[]
    }

    return {
      success: true,
      output: {
        templates: data.result || data.templates || [],
      },
    }
  },

  outputs: {
    templates: { type: 'json', description: 'Array of templates' },
  },
}
