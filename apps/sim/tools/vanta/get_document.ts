import type { ToolConfig } from '@/tools/types'
import { VANTA_DOCUMENT_DETAIL_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetDocumentParams, VantaGetDocumentResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaGetDocumentTool: ToolConfig<VantaGetDocumentParams, VantaGetDocumentResponse> = {
  id: 'vanta_get_document',
  name: 'Vanta Get Document',
  description:
    'Get a Vanta evidence document by ID, including its renewal schedule and deactivation status',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
    },
    documentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the document',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_get_document',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
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
