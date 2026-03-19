import type {
  DocuSignCreateFromTemplateParams,
  DocuSignCreateFromTemplateResponse,
} from '@/tools/docusign/types'
import type { ToolConfig } from '@/tools/types'

export const docusignCreateFromTemplateTool: ToolConfig<
  DocuSignCreateFromTemplateParams,
  DocuSignCreateFromTemplateResponse
> = {
  id: 'docusign_create_from_template',
  name: 'Send from DocuSign Template',
  description: 'Create and send a DocuSign envelope using a pre-built template',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'docusign',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'DocuSign OAuth access token',
    },
    templateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'DocuSign template ID to use',
    },
    emailSubject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override email subject (uses template default if not set)',
    },
    emailBody: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override email body message',
    },
    templateRoles: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of template roles, e.g. [{"roleName":"Signer","name":"John","email":"john@example.com"}]',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Envelope status: "sent" to send immediately, "created" for draft (default: "sent")',
    },
  },

  request: {
    url: '/api/tools/docusign',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      operation: 'create_from_template',
      templateId: params.templateId,
      emailSubject: params.emailSubject,
      emailBody: params.emailBody,
      templateRoles: params.templateRoles,
      status: params.status,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.success === false) {
      throw new Error(data.error || 'Failed to create envelope from template')
    }
    return {
      success: true,
      output: {
        envelopeId: data.envelopeId ?? null,
        status: data.status ?? null,
        statusDateTime: data.statusDateTime ?? null,
        uri: data.uri ?? null,
      },
    }
  },

  outputs: {
    envelopeId: { type: 'string', description: 'Created envelope ID' },
    status: { type: 'string', description: 'Envelope status' },
    statusDateTime: { type: 'string', description: 'Status change datetime', optional: true },
    uri: { type: 'string', description: 'Envelope URI', optional: true },
  },
}
