import type { SESCreateTemplateParams, SESCreateTemplateResponse } from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const createTemplateTool: ToolConfig<SESCreateTemplateParams, SESCreateTemplateResponse> = {
  id: 'ses_create_template',
  name: 'SES Create Template',
  description: 'Create a new SES email template for use with templated email sending',
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
      description: 'Unique name for the email template',
    },
    subjectPart: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Subject line template (supports {{variable}} substitution)',
    },
    textPart: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text version of the template body',
    },
    htmlPart: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML version of the template body',
    },
  },

  request: {
    url: '/api/tools/ses/create-template',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      templateName: params.templateName,
      subjectPart: params.subjectPart,
      textPart: params.textPart,
      htmlPart: params.htmlPart,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create template')
    }

    return {
      success: true,
      output: {
        message: data.message ?? 'Template created successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation message for the created template' },
  },
}
