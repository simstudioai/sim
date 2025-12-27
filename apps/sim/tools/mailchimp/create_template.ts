import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpCreateTemplate')

export interface MailchimpCreateTemplateParams {
  apiKey: string
  templateName: string
  templateHtml: string
}

export interface MailchimpCreateTemplateResponse {
  success: boolean
  output: {
    template: any
    metadata: {
      operation: 'create_template'
      templateId: string
    }
    success: boolean
  }
}

export const mailchimpCreateTemplateTool: ToolConfig<
  MailchimpCreateTemplateParams,
  MailchimpCreateTemplateResponse
> = {
  id: 'mailchimp_create_template',
  name: 'Create Template in Mailchimp',
  description: 'Create a new template in Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    templateName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The name of the template',
    },
    templateHtml: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The HTML content for the template',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, '/templates'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      name: params.templateName,
      html: params.templateHtml,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'create_template')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        template: data,
        metadata: {
          operation: 'create_template' as const,
          templateId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created template data',
      properties: {
        template: { type: 'object', description: 'Created template object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
