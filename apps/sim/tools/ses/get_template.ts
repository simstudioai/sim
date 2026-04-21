import type { SESGetTemplateParams, SESGetTemplateResponse } from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const getTemplateTool: ToolConfig<SESGetTemplateParams, SESGetTemplateResponse> = {
  id: 'ses_get_template',
  name: 'SES Get Template',
  description: 'Retrieve the content and details of an SES email template',
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
      description: 'Name of the template to retrieve',
    },
  },

  request: {
    url: '/api/tools/ses/get-template',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      templateName: params.templateName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get template')
    }

    return {
      success: true,
      output: {
        templateName: data.templateName ?? '',
        subjectPart: data.subjectPart ?? '',
        textPart: data.textPart ?? null,
        htmlPart: data.htmlPart ?? null,
      },
    }
  },

  outputs: {
    templateName: { type: 'string', description: 'Name of the template' },
    subjectPart: { type: 'string', description: 'Subject line of the template' },
    textPart: {
      type: 'string',
      description: 'Plain text body of the template',
      optional: true,
    },
    htmlPart: {
      type: 'string',
      description: 'HTML body of the template',
      optional: true,
    },
  },
}
