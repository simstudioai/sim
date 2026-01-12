import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpTemplate } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetTemplate')

export interface MailchimpGetTemplateParams {
  apiKey: string
  templateId: string
}

export interface MailchimpGetTemplateResponse {
  success: boolean
  output: {
    template: MailchimpTemplate
    template_id: string
  }
}

export const mailchimpGetTemplateTool: ToolConfig<
  MailchimpGetTemplateParams,
  MailchimpGetTemplateResponse
> = {
  id: 'mailchimp_get_template',
  name: 'Get Template from Mailchimp',
  description: 'Retrieve details of a specific template from Mailchimp',
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
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/templates/${params.templateId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_template')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        template: data,
        template_id: data.id,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the template was successfully retrieved' },
    output: {
      type: 'object',
      description: 'Template data',
      properties: {
        template: { type: 'json', description: 'Template object' },
        template_id: { type: 'string', description: 'The unique ID of the template' },
      },
    },
  },
}
