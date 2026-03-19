import type {
  DocuSignListRecipientsParams,
  DocuSignListRecipientsResponse,
} from '@/tools/docusign/types'
import { RECIPIENTS_ARRAY_OUTPUT } from '@/tools/docusign/types'
import type { ToolConfig } from '@/tools/types'

export const docusignListRecipientsTool: ToolConfig<
  DocuSignListRecipientsParams,
  DocuSignListRecipientsResponse
> = {
  id: 'docusign_list_recipients',
  name: 'List DocuSign Recipients',
  description: 'Get the recipient status details for a DocuSign envelope',
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
      description: 'The envelope ID to get recipients for',
    },
  },

  request: {
    url: '/api/tools/docusign',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      operation: 'list_recipients',
      envelopeId: params.envelopeId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.success === false) {
      throw new Error(data.error || 'Failed to list recipients')
    }
    const signers = (data.signers ?? []).map((s: Record<string, unknown>) => ({
      recipientId: s.recipientId ?? null,
      name: s.name ?? null,
      email: s.email ?? null,
      status: s.status ?? null,
      signedDateTime: s.signedDateTime ?? null,
      deliveredDateTime: s.deliveredDateTime ?? null,
    }))
    const carbonCopies = (data.carbonCopies ?? []).map((cc: Record<string, unknown>) => ({
      recipientId: cc.recipientId ?? null,
      name: cc.name ?? null,
      email: cc.email ?? null,
      status: cc.status ?? null,
    }))
    return {
      success: true,
      output: {
        signers,
        carbonCopies,
      },
    }
  },

  outputs: {
    signers: RECIPIENTS_ARRAY_OUTPUT,
    carbonCopies: {
      type: 'array',
      description: 'Array of carbon copy recipients',
      items: {
        type: 'object',
        properties: {
          recipientId: { type: 'string', description: 'Recipient ID' },
          name: { type: 'string', description: 'Recipient name' },
          email: { type: 'string', description: 'Recipient email' },
          status: { type: 'string', description: 'Recipient status' },
        },
      },
    },
  },
}
