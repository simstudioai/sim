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
      description: 'Number of templates to return per page (default: 20, max: 200)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response (nextPageToken) to fetch the next page',
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
      if (params.pageToken) {
        url.searchParams.append('page_token', params.pageToken)
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
      _metadata?: { next?: string }
    }

    let nextPageToken: string | null = null
    if (data._metadata?.next) {
      try {
        nextPageToken = new URL(data._metadata.next).searchParams.get('page_token')
      } catch {
        nextPageToken = null
      }
    }

    return {
      success: true,
      output: {
        templates: data.result || [],
        nextPageToken,
      },
    }
  },

  outputs: {
    templates: { type: 'json', description: 'Array of templates' },
    nextPageToken: {
      type: 'string',
      description: 'Token to pass as pageToken to fetch the next page, if more results exist',
      optional: true,
    },
  },
}
