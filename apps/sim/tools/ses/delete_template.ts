import type { SESDeleteTemplateParams, SESDeleteTemplateResponse } from '@/tools/ses/types'
import type { InternalToolConfig } from '@/tools/types'

export const deleteTemplateTool: InternalToolConfig<
  SESDeleteTemplateParams,
  SESDeleteTemplateResponse
> = {
  id: 'ses_delete_template',
  name: 'SES Delete Template',
  description: 'Delete an existing SES email template',
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
      description: 'Name of the template to delete',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      templateName: params.templateName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete template')
    }

    return {
      success: true,
      output: {
        message: data.message ?? 'Template deleted successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation message for the deleted template' },
  },
}
