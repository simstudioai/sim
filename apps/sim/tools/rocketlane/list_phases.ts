import {
  mapPagination,
  mapPhase,
  PAGINATION_OUTPUT_PROPERTIES,
  PHASE_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListPhasesParams,
  type RocketlanePhaseListResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListPhasesTool: ToolConfig<
  RocketlaneListPhasesParams,
  RocketlanePhaseListResponse
> = {
  id: 'rocketlane_list_phases',
  name: 'Rocketlane List Phases',
  description:
    'List phases of a Rocketlane project, with optional filters, sorting, and pagination',
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
      description: 'ID of the project to list phases for',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of phases per page',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token returned by a previous request (valid for 15 minutes)',
    },
    includeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra phase properties to include in the response (supported: startDateActual, dueDateActual)',
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to return all phase properties in the response',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Property to sort by (phaseName, startDate, dueDate, startDateActual, dueDateActual)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order (ASC or DESC)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether results must match all filters or any filter (all or any)',
    },
    phaseName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by exact phase name',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/phases`)
      url.searchParams.set('projectId', String(params.projectId))
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.phaseName) url.searchParams.set('phaseName.eq', params.phaseName)
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
    const phases = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        phases: phases.map(mapPhase),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    phases: {
      type: 'array',
      description: 'List of phases',
      items: { type: 'object', properties: PHASE_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
