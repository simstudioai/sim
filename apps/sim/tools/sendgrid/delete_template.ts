import type { DeleteTemplateParams } from '@/tools/sendgrid/types'
import { SENDGRID_REGION_PARAM, sendGridApiBase } from '@/tools/sendgrid/utils'
import { SENDGRID_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const sendGridDeleteTemplateTool: ToolConfig<DeleteTemplateParams, ToolResponse> = {
  id: 'sendgrid_delete_template',
  name: 'SendGrid Delete Template',
  description: 'Delete an email template from SendGrid',
  version: '1.0.0',
  oauth: SENDGRID_CREDENTIAL_OAUTH,

  params: {
    region: SENDGRID_REGION_PARAM,
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
      description: 'Template ID to delete',
    },
  },

  request: {
    url: (params) => `${sendGridApiBase(params.region)}/templates/${params.templateId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ToolResponse> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to delete template')
    }

    return {
      success: true,
      output: {},
    }
  },

  outputs: {},
}
