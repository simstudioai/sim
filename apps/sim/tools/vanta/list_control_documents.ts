import type { InternalToolConfig } from '@/tools/types'
import {
  VANTA_DOCUMENT_OUTPUT_PROPERTIES,
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListControlDocumentsParams,
  VantaListDocumentsResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaListControlDocumentsTool: InternalToolConfig<
  VantaListControlDocumentsParams,
  VantaListDocumentsResponse
> = {
  id: 'vanta_list_control_documents',
  name: 'Vanta List Control Documents',
  description: 'List the evidence documents mapped to a specific Vanta control',
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
    controlId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the control',
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

  operation: {
    input: (params) => ({
      operation: 'vanta_list_control_documents',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
      controlId: params.controlId,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListDocumentsResponse>(
    'Failed to list Vanta control documents'
  ),

  outputs: {
    documents: {
      type: 'array',
      description: 'Documents mapped to the control',
      items: { type: 'object', properties: VANTA_DOCUMENT_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'json',
      description:
        'Cursor pagination info for the returned page; pass endCursor as pageCursor to fetch the next page',
      nullable: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
