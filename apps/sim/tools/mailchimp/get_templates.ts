import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpTemplate } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetTemplates')

export interface MailchimpGetTemplatesParams {
  apiKey: string
  count?: string
  offset?: string
}

export interface MailchimpGetTemplatesResponse {
  success: boolean
  output: {
    templates: MailchimpTemplate[]
    totalItems: number
    metadata: {
      operation: 'get_templates'
      totalReturned: number
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'Number of results (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to skip',
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
        totalItems: data.total_items || templates.length,
        metadata: {
          operation: 'get_templates' as const,
          totalReturned: templates.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Templates data and metadata',
      properties: {
        templates: { type: 'array', description: 'Array of template objects' },
        totalItems: { type: 'number', description: 'Total number of templates' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
