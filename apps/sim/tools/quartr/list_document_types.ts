import {
  QUARTR_DOCUMENT_TYPE_OUTPUT_PROPERTIES,
  type QuartrDocumentTypeDto,
  type QuartrListDocumentTypesParams,
  type QuartrListDocumentTypesResponse,
  type QuartrPaginatedDto,
} from '@/tools/quartr/types'
import { buildQuartrUrl, mapQuartrDocumentType, parseQuartrResponse } from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrListDocumentTypesTool: ToolConfig<
  QuartrListDocumentTypesParams,
  QuartrListDocumentTypesResponse
> = {
  id: 'quartr_list_document_types',
  name: 'Quartr List Document Types',
  description:
    'List the document types available in Quartr (e.g., 10-Q quarterly reports), useful for filtering documents by type ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return in a single request (default: 10, max: 500)',
    },
    cursor: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from the previous response (nextCursor) for the next page',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort direction by id: "asc" or "desc" (default: asc)',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl('/document-types', {
        limit: params.limit,
        cursor: params.cursor,
        direction: params.direction,
      }),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrPaginatedDto<QuartrDocumentTypeDto>>(
      response,
      'list document types'
    )

    return {
      success: true,
      output: {
        documentTypes: (data.data ?? []).map(mapQuartrDocumentType),
        nextCursor: data.pagination?.nextCursor ?? null,
      },
    }
  },

  outputs: {
    documentTypes: {
      type: 'array',
      description: 'Available document types',
      items: { type: 'object', properties: QUARTR_DOCUMENT_TYPE_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'number',
      description: 'Cursor for fetching the next page of results (null when no more pages)',
      optional: true,
    },
  },
}
