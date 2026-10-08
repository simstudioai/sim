import type { InternalToolConfig } from '@/tools/types'
import { VANTA_DOCUMENT_DETAIL_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetDocumentParams, VantaGetDocumentResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetDocumentTool: InternalToolConfig<
  VantaGetDocumentParams,
  VantaGetDocumentResponse
> = {
  id: 'vanta_get_document',
  name: 'Vanta Get Document',
  description:
    'Get a Vanta evidence document by ID, including its renewal schedule and deactivation status',
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
      description: 'Unique ID of the document',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'vanta_get_document',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
      documentId: params.documentId,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaGetDocumentResponse>(
    'Failed to get Vanta document'
  ),

  outputs: {
    document: {
      type: 'json',
      description: 'The requested document',
      properties: VANTA_DOCUMENT_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
