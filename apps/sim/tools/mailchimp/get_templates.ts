import type { MailchimpTemplate } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetTemplatesParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetTemplatesResponse {
  success: boolean
  output: {
    templates: MailchimpTemplate[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetTemplatesTool: ToolConfig<
  MailchimpGetTemplatesParams,
  MailchimpGetTemplatesResponse
> = {
  id: 'mailchimp_get_templates',
  name: 'Get Templates from Mailchimp',
  description: 'Retrieve a list of templates from Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.count) queryParams.append('count', params.count)
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildMailchimpUrl(params.apiKey, '/templates')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_templates')
    }

    const data = await response.json()
    const templates = data.templates || []

    return {
      success: true,
      output: {
        templates,
        total_items: data.total_items || templates.length,
        total_returned: templates.length,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the templates were successfully retrieved' },
    output: {
      type: 'object',
      description: 'Templates data',
      properties: {
        templates: { type: 'json', description: 'Array of template objects' },
        total_items: { type: 'number', description: 'Total number of templates' },
        total_returned: {
          type: 'number',
          description: 'Number of templates returned in this response',
        },
      },
    },
  },
}
