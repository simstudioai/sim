import type {
  CreateTemplateVersionParams,
  SendGridTemplateVersionRequest,
  TemplateVersionResult,
} from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridCreateTemplateVersionTool: ToolConfig<
  CreateTemplateVersionParams,
  TemplateVersionResult
> = {
  id: 'sendgrid_create_template_version',
  name: 'SendGrid Create Template Version',
  description: 'Create a new version of an email template in SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    templateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Template ID',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Version name',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject line',
    },
    htmlContent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML content of the template',
    },
    plainContent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text content of the template',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this version is active (default: true)',
    },
  },

  request: {
    url: (params) => `https://api.sendgrid.com/v3/templates/${params.templateId}/versions`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: SendGridTemplateVersionRequest = {
        name: params.name,
        subject: params.subject,
        active: params.active !== undefined ? params.active : 1,
      }

      if (params.htmlContent) {
        body.html_content = params.htmlContent
      }

      if (params.plainContent) {
        body.plain_content = params.plainContent
      }

      return { body: JSON.stringify(body) }
    },
  },

  transformResponse: async (response): Promise<TemplateVersionResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.errors?.[0]?.message || 'Failed to create template version')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        templateId: data.template_id,
        name: data.name,
        subject: data.subject,
        active: data.active === 1,
        htmlContent: data.html_content,
        plainContent: data.plain_content,
        updatedAt: data.updated_at,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Version ID' },
    templateId: { type: 'string', description: 'Template ID' },
    name: { type: 'string', description: 'Version name' },
    subject: { type: 'string', description: 'Email subject' },
    active: { type: 'boolean', description: 'Whether this version is active' },
    htmlContent: { type: 'string', description: 'HTML content' },
    plainContent: { type: 'string', description: 'Plain text content' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
  },
}
