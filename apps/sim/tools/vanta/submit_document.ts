import type { ToolConfig } from '@/tools/types'
import type { VantaSubmitDocumentParams, VantaSubmitDocumentResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaSubmitDocumentTool: ToolConfig<
  VantaSubmitDocumentParams,
  VantaSubmitDocumentResponse
> = {
  id: 'vanta_submit_document',
  name: 'Vanta Submit Document',
  description:
    'Submit a Vanta document collection for review so uploaded evidence becomes visible to auditors. Requires credentials with write access.',
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
      description: 'Unique ID of the document to submit',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_submit_document',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
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
