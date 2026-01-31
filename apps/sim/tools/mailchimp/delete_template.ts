import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteTemplateParams {
  apiKey: string
  templateId: string
}

export interface MailchimpDeleteTemplateResponse {
  success: boolean
}

export const mailchimpDeleteTemplateTool: ToolConfig<
  MailchimpDeleteTemplateParams,
  MailchimpDeleteTemplateResponse
> = {
  id: 'mailchimp_delete_template',
  name: 'Delete Template from Mailchimp',
  description: 'Delete a template from Mailchimp',
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
      description: 'The unique ID for the template to delete (e.g., "12345")',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/templates/${params.templateId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_template')
    }

    return {
      success: true,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the template was successfully deleted' },
  },
}
