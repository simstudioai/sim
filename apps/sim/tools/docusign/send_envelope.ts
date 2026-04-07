import type {
  DocuSignSendEnvelopeParams,
  DocuSignSendEnvelopeResponse,
} from '@/tools/docusign/types'
import type { ToolConfig } from '@/tools/types'

export const docusignSendEnvelopeTool: ToolConfig<
  DocuSignSendEnvelopeParams,
  DocuSignSendEnvelopeResponse
> = {
  id: 'docusign_send_envelope',
  name: 'Send DocuSign Envelope',
  description: 'Create and send a DocuSign envelope with a document for e-signature',
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
    emailSubject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject for the envelope',
    },
    emailBody: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email body message',
    },
    signerEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the signer',
    },
    signerName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full name of the signer',
    },
    ccEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of carbon copy recipient',
    },
    ccName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name of carbon copy recipient',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document file to send for signature',
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
      operation: 'send_envelope',
      emailSubject: params.emailSubject,
      emailBody: params.emailBody,
      signerEmail: params.signerEmail,
      signerName: params.signerName,
      ccEmail: params.ccEmail,
      ccName: params.ccName,
      file: params.file,
      status: params.status,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.success === false) {
      throw new Error(data.error || 'Failed to send envelope')
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
