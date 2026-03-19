import type {
  DocuSignVoidEnvelopeParams,
  DocuSignVoidEnvelopeResponse,
} from '@/tools/docusign/types'
import type { ToolConfig } from '@/tools/types'

export const docusignVoidEnvelopeTool: ToolConfig<
  DocuSignVoidEnvelopeParams,
  DocuSignVoidEnvelopeResponse
> = {
  id: 'docusign_void_envelope',
  name: 'Void DocuSign Envelope',
  description: 'Void (cancel) a sent DocuSign envelope that has not yet been completed',
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
      description: 'The envelope ID to void',
    },
    voidedReason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reason for voiding the envelope',
    },
  },

  request: {
    url: '/api/tools/docusign',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      operation: 'void_envelope',
      envelopeId: params.envelopeId,
      voidedReason: params.voidedReason,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.success === false) {
      throw new Error(data.error || 'Failed to void envelope')
    }
    return {
      success: true,
      output: {
        envelopeId: data.envelopeId ?? null,
        status: data.status ?? 'voided',
      },
    }
  },

  outputs: {
    envelopeId: { type: 'string', description: 'Voided envelope ID' },
    status: { type: 'string', description: 'Envelope status (voided)' },
  },
}
