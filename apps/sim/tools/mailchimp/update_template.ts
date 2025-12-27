import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpTemplate } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpUpdateTemplate')

export interface MailchimpUpdateTemplateParams {
  apiKey: string
  templateId: string
  templateName?: string
  templateHtml?: string
}

export interface MailchimpUpdateTemplateResponse {
  success: boolean
  output: {
    template: MailchimpTemplate
    metadata: {
      operation: 'update_template'
      templateId: string
    }
    success: boolean
  }
}

export const mailchimpUpdateTemplateTool: ToolConfig<
  MailchimpUpdateTemplateParams,
  MailchimpUpdateTemplateResponse
> = {
  id: 'mailchimp_update_template',
  name: 'Update Template in Mailchimp',
  description: 'Update an existing template in Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    templateId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the template',
    },
    templateName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The name of the template',
    },
    templateHtml: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The HTML content for the template',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/templates/${params.templateId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.templateName) body.name = params.templateName
      if (params.templateHtml) body.html = params.templateHtml

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'update_template')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        template: data,
        metadata: {
          operation: 'update_template' as const,
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
      description: 'Updated template data',
      properties: {
        template: { type: 'object', description: 'Updated template object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
