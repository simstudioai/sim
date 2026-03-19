import type { DocuSignGetEnvelopeParams, DocuSignGetEnvelopeResponse } from '@/tools/docusign/types'
import type { ToolConfig } from '@/tools/types'

export const docusignGetEnvelopeTool: ToolConfig<
  DocuSignGetEnvelopeParams,
  DocuSignGetEnvelopeResponse
> = {
  id: 'docusign_get_envelope',
  name: 'Get DocuSign Envelope',
  description: 'Get the details and status of a DocuSign envelope',
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
    envelopeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The envelope ID to retrieve',
    },
  },

  request: {
    url: '/api/tools/docusign',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      operation: 'get_envelope',
      envelopeId: params.envelopeId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.success === false) {
      throw new Error(data.error || 'Failed to get envelope')
    }
    return {
      success: true,
      output: {
        envelopeId: data.envelopeId ?? null,
        status: data.status ?? null,
        emailSubject: data.emailSubject ?? null,
        sentDateTime: data.sentDateTime ?? null,
        completedDateTime: data.completedDateTime ?? null,
        createdDateTime: data.createdDateTime ?? null,
        statusChangedDateTime: data.statusChangedDateTime ?? null,
        voidedReason: data.voidedReason ?? null,
        signerCount: data.recipients?.signers?.length ?? 0,
        documentCount: data.envelopeDocuments?.length ?? 0,
      },
    }
  },

  outputs: {
    envelopeId: { type: 'string', description: 'Envelope ID' },
    status: {
      type: 'string',
      description: 'Envelope status (created, sent, delivered, completed, declined, voided)',
    },
    emailSubject: { type: 'string', description: 'Email subject line' },
    sentDateTime: { type: 'string', description: 'When the envelope was sent', optional: true },
    completedDateTime: {
      type: 'string',
      description: 'When all recipients completed signing',
      optional: true,
    },
    createdDateTime: { type: 'string', description: 'When the envelope was created' },
    statusChangedDateTime: { type: 'string', description: 'When the status last changed' },
    voidedReason: { type: 'string', description: 'Reason the envelope was voided', optional: true },
    signerCount: { type: 'number', description: 'Number of signers' },
    documentCount: { type: 'number', description: 'Number of documents' },
  },
}
