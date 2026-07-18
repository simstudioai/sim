import {
  mapPagination,
  mapResourceAllocation,
  PAGINATION_OUTPUT_PROPERTIES,
  RESOURCE_ALLOCATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneResourceAllocationListParams,
  type RocketlaneResourceAllocationListResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListResourceAllocationsTool: ToolConfig<
  RocketlaneResourceAllocationListParams,
  RocketlaneResourceAllocationListResponse
> = {
  id: 'rocketlane_list_resource_allocations',
  name: 'Rocketlane List Resource Allocations',
  description:
    'List resource allocations in Rocketlane within a date range, with optional member, project, and placeholder filters, sorting, and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Return allocations that start on or after this date (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Return allocations that end on or before this date (YYYY-MM-DD)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of allocations per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response (valid for 15 minutes)',
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional fields to include in the response: member, task, placeholder, duration',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by: startDate, endDate, allocationType, or allocationFor',
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
      description: 'Combine filters with AND (all) or OR (any); defaults to all',
    },
    memberIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return allocations that exactly match this member ID',
    },
    memberIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated member IDs to match any of',
    },
    memberIdNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated member IDs to exclude',
    },
    projectIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return allocations that exactly match this project ID',
    },
    projectIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated project IDs to match any of',
    },
    projectIdNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated project IDs to exclude',
    },
    placeholderIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return allocations that exactly match this placeholder ID',
    },
    placeholderIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated placeholder IDs to match any of',
    },
    placeholderIdNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated placeholder IDs to exclude',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/resource-allocations`)
      url.searchParams.set('startDate', params.startDate)
      url.searchParams.set('endDate', params.endDate)
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.includeFields?.length) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.memberIdEq) url.searchParams.set('memberId.eq', params.memberIdEq)
      if (params.memberIdOneOf) url.searchParams.set('memberId.oneOf', params.memberIdOneOf)
      if (params.memberIdNoneOf) url.searchParams.set('memberId.noneOf', params.memberIdNoneOf)
      if (params.projectIdEq) url.searchParams.set('projectId.eq', params.projectIdEq)
      if (params.projectIdOneOf) url.searchParams.set('projectId.oneOf', params.projectIdOneOf)
      if (params.projectIdNoneOf) {
        url.searchParams.set('projectId.noneOf', params.projectIdNoneOf)
      }
      if (params.placeholderIdEq) {
        url.searchParams.set('placeholderId.eq', params.placeholderIdEq)
      }
      if (params.placeholderIdOneOf) {
        url.searchParams.set('placeholderId.oneOf', params.placeholderIdOneOf)
      }
      if (params.placeholderIdNoneOf) {
        url.searchParams.set('placeholderId.noneOf', params.placeholderIdNoneOf)
      }
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
    const allocations = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        allocations: allocations.map(mapResourceAllocation),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    allocations: {
      type: 'array',
      description: 'List of resource allocations',
      items: { type: 'object', properties: RESOURCE_ALLOCATION_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
