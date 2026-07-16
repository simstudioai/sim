import {
  mapPagination,
  mapSpace,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListSpacesParams,
  type RocketlaneListSpacesResponse,
  rocketlaneError,
  rocketlaneHeaders,
  SPACE_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListSpacesTool: ToolConfig<
  RocketlaneListSpacesParams,
  RocketlaneListSpacesResponse
> = {
  id: 'rocketlane_list_spaces',
  name: 'Rocketlane List Spaces',
  description:
    'List spaces in a Rocketlane project, with optional filters, sorting, and pagination',
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
      description: 'ID of the project whose spaces to list',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of spaces per page (defaults to 100)',
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
      description: 'Field to sort by (spaceName)',
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
    spaceNameEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces whose name exactly matches this value',
    },
    spaceNameCn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces whose name contains this value',
    },
    spaceNameNc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude spaces whose name contains this value',
    },
    createdAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces created after this time (epoch millis)',
    },
    createdAtEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces created at exactly this time (epoch millis)',
    },
    createdAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces created before this time (epoch millis)',
    },
    createdAtGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces created at or after this time (epoch millis)',
    },
    createdAtLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces created at or before this time (epoch millis)',
    },
    updatedAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces updated after this time (epoch millis)',
    },
    updatedAtEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces updated at exactly this time (epoch millis)',
    },
    updatedAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces updated before this time (epoch millis)',
    },
    updatedAtGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces updated at or after this time (epoch millis)',
    },
    updatedAtLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include spaces updated at or before this time (epoch millis)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/spaces`)
      url.searchParams.set('projectId', String(params.projectId))
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.spaceNameEq) url.searchParams.set('spaceName.eq', params.spaceNameEq)
      if (params.spaceNameCn) url.searchParams.set('spaceName.cn', params.spaceNameCn)
      if (params.spaceNameNc) url.searchParams.set('spaceName.nc', params.spaceNameNc)
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
    const spaces = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        spaces: spaces.map(mapSpace),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    spaces: {
      type: 'array',
      description: 'List of spaces',
      items: { type: 'object', properties: SPACE_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
