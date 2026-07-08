import type { SESUpdateTemplateParams, SESUpdateTemplateResponse } from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const updateTemplateTool: ToolConfig<SESUpdateTemplateParams, SESUpdateTemplateResponse> = {
  id: 'ses_update_template',
  name: 'SES Update Template',
  description: 'Update the subject, HTML, and text content of an existing SES email template',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    templateName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the template to update',
    },
    subjectPart: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The subject line of the template',
    },
    htmlPart: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The HTML body of the template',
    },
    textPart: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The plain text body of the template',
    },
  },

  request: {
    url: '/api/tools/ses/update-template',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      templateName: params.templateName,
      subjectPart: params.subjectPart,
      htmlPart: params.htmlPart,
      textPart: params.textPart,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update template')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation message' },
  },
}
