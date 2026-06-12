import type { ToolConfig } from '@/tools/types'
import {
  VANTA_DOCUMENT_OUTPUT_PROPERTIES,
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListDocumentsParams, VantaListDocumentsResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListDocumentsTool: ToolConfig<
  VantaListDocumentsParams,
  VantaListDocumentsResponse
> = {
  id: 'vanta_list_documents',
  name: 'Vanta List Documents',
  description:
    'List the evidence documents in a Vanta account, optionally filtered by framework or document status',
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
    frameworkMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated framework IDs to filter documents by (e.g., soc2,iso27001)',
    },
    statusMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated document statuses to filter by: "Needs document", "Needs update", "Not relevant", "OK"',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items per page (1-100, default 10)',
    },
    pageCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor: pass the endCursor from the previous response to fetch the next page',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_list_documents',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      frameworkMatchesAny: params.frameworkMatchesAny,
      statusMatchesAny: params.statusMatchesAny,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListDocumentsResponse>(
    'Failed to list Vanta documents'
  ),

  outputs: {
    documents: {
      type: 'array',
      description: 'Documents matching the filters',
      items: { type: 'object', properties: VANTA_DOCUMENT_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'json',
      description:
        'Cursor pagination info for the returned page; pass endCursor as pageCursor to fetch the next page',
      optional: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
