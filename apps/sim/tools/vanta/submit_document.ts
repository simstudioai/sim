import type { InternalToolConfig } from '@/tools/types'
import type { VantaSubmitDocumentParams, VantaSubmitDocumentResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaSubmitDocumentTool: InternalToolConfig<
  VantaSubmitDocumentParams,
  VantaSubmitDocumentResponse
> = {
  id: 'vanta_submit_document',
  name: 'Vanta Submit Document',
  description:
    'Submit a Vanta document collection for review so uploaded evidence becomes visible to auditors. Requires credentials with write access.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'vanta',
    credentialKind: 'service-account',
    authoritativeParams: ['apiDomain'],
    retryOnUnauthorized: true,
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token supplied by the saved Vanta credential',
    },
    apiDomain: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'API origin supplied by the saved Vanta credential',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the document to submit',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'vanta_submit_document',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
      documentId: params.documentId,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaSubmitDocumentResponse>(
    'Failed to submit Vanta document'
  ),

  outputs: {
    documentId: { type: 'string', description: 'ID of the submitted document' },
    submitted: { type: 'boolean', description: 'Whether the document collection was submitted' },
  },
}
