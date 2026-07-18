import {
  mapPagination,
  mapSpaceDocument,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListSpaceDocumentsParams,
  type RocketlaneListSpaceDocumentsResponse,
  rocketlaneError,
  rocketlaneHeaders,
  SPACE_DOCUMENT_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListSpaceDocumentsTool: ToolConfig<
  RocketlaneListSpaceDocumentsParams,
  RocketlaneListSpaceDocumentsResponse
> = {
  id: 'rocketlane_list_space_documents',
  name: 'Rocketlane List Space Documents',
  description:
    'List space documents in a Rocketlane project, with optional filters, sorting, and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the project whose space documents to list',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of space documents per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous request (valid for 15 minutes)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by (spaceTabName)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: ASC or DESC (defaults to DESC)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How to combine filters: all (AND) or any (OR); defaults to all',
    },
    spaceDocumentNameEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents whose name exactly matches this value',
    },
    spaceDocumentNameCn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents whose name contains this value',
    },
    spaceDocumentNameNc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude space documents whose name contains this value',
    },
    spaceIdEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents in the space with this ID',
    },
    createdAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents created after this time (epoch millis)',
    },
    createdAtEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents created at exactly this time (epoch millis)',
    },
    createdAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents created before this time (epoch millis)',
    },
    createdAtGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents created at or after this time (epoch millis)',
    },
    createdAtLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents created at or before this time (epoch millis)',
    },
    updatedAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents updated after this time (epoch millis)',
    },
    updatedAtEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents updated at exactly this time (epoch millis)',
    },
    updatedAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents updated before this time (epoch millis)',
    },
    updatedAtGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents updated at or after this time (epoch millis)',
    },
    updatedAtLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include space documents updated at or before this time (epoch millis)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/space-documents`)
      url.searchParams.set('projectId', String(params.projectId))
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.spaceDocumentNameEq)
        url.searchParams.set('spaceDocumentName.eq', params.spaceDocumentNameEq)
      if (params.spaceDocumentNameCn)
        url.searchParams.set('spaceDocumentName.cn', params.spaceDocumentNameCn)
      if (params.spaceDocumentNameNc)
        url.searchParams.set('spaceDocumentName.nc', params.spaceDocumentNameNc)
      if (params.spaceIdEq != null) url.searchParams.set('spaceId.eq', String(params.spaceIdEq))
      if (params.createdAtGt != null)
        url.searchParams.set('createdAt.gt', String(params.createdAtGt))
      if (params.createdAtEq != null)
        url.searchParams.set('createdAt.eq', String(params.createdAtEq))
      if (params.createdAtLt != null)
        url.searchParams.set('createdAt.lt', String(params.createdAtLt))
      if (params.createdAtGe != null)
        url.searchParams.set('createdAt.ge', String(params.createdAtGe))
      if (params.createdAtLe != null)
        url.searchParams.set('createdAt.le', String(params.createdAtLe))
      if (params.updatedAtGt != null)
        url.searchParams.set('updatedAt.gt', String(params.updatedAtGt))
      if (params.updatedAtEq != null)
        url.searchParams.set('updatedAt.eq', String(params.updatedAtEq))
      if (params.updatedAtLt != null)
        url.searchParams.set('updatedAt.lt', String(params.updatedAtLt))
      if (params.updatedAtGe != null)
        url.searchParams.set('updatedAt.ge', String(params.updatedAtGe))
      if (params.updatedAtLe != null)
        url.searchParams.set('updatedAt.le', String(params.updatedAtLe))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    const spaceDocuments = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        spaceDocuments: spaceDocuments.map(mapSpaceDocument),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    spaceDocuments: {
      type: 'array',
      description: 'List of space documents',
      items: { type: 'object', properties: SPACE_DOCUMENT_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
