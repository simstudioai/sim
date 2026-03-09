import type { MailchimpTemplate } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

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
    template_id: string
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the template (e.g., "12345")',
    },
    templateName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the template (e.g., "Monthly Newsletter")',
    },
    templateHtml: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
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
        template_id: data.id,
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
        template_id: { type: 'string', description: 'Template ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
