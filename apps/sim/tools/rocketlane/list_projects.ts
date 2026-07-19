import {
  mapPagination,
  mapProject,
  PAGINATION_OUTPUT_PROPERTIES,
  PROJECT_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListProjectsParams,
  type RocketlaneProjectListResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListProjectsTool: ToolConfig<
  RocketlaneListProjectsParams,
  RocketlaneProjectListResponse
> = {
  id: 'rocketlane_list_projects',
  name: 'Rocketlane List Projects',
  description:
    'List Rocketlane projects with optional filters, sorting, and token-based pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of projects per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response (valid for 15 minutes)',
    },
    includeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra fields to return in the response (e.g. budgetedHours,progressPercentage)',
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response body',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by: projectName, startDate, dueDate, startDateActual, dueDateActual, annualizedRecurringRevenue, or projectFee',
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
    projectNameContains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects whose name contains this value',
    },
    projectNameEquals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects whose name exactly matches this value',
    },
    statusEquals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects with this status value',
    },
    statusOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated status values; returns projects matching any of them',
    },
    customerIdEquals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects for this customer company ID',
    },
    customerIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated customer company IDs; returns projects matching any of them',
    },
    teamMemberIdEquals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects that include this team member ID',
    },
    contractTypeEquals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return projects with this contract type: FIXED_FEE, TIME_AND_MATERIAL, SUBSCRIPTION, or NON_BILLABLE',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include archived projects in the results',
    },
    externalReferenceIdEquals: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects with this external reference ID',
    },
    startDateAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects whose start date is after this date (YYYY-MM-DD)',
    },
    startDateBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects whose start date is before this date (YYYY-MM-DD)',
    },
    dueDateAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects whose due date is after this date (YYYY-MM-DD)',
    },
    dueDateBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return projects whose due date is before this date (YYYY-MM-DD)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/projects`)
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null)
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.projectNameContains)
        url.searchParams.set('projectName.cn', params.projectNameContains)
      if (params.projectNameEquals) url.searchParams.set('projectName.eq', params.projectNameEquals)
      if (params.statusEquals) url.searchParams.set('status.eq', params.statusEquals)
      if (params.statusOneOf) url.searchParams.set('status.oneOf', params.statusOneOf)
      if (params.customerIdEquals) url.searchParams.set('customerId.eq', params.customerIdEquals)
      if (params.customerIdOneOf) url.searchParams.set('customerId.oneOf', params.customerIdOneOf)
      if (params.teamMemberIdEquals)
        url.searchParams.set('teamMemberId.eq', params.teamMemberIdEquals)
      if (params.contractTypeEquals)
        url.searchParams.set('contractType.eq', params.contractTypeEquals)
      if (params.includeArchived != null)
        url.searchParams.set('includeArchive.eq', String(params.includeArchived))
      if (params.externalReferenceIdEquals)
        url.searchParams.set('externalReferenceId.eq', params.externalReferenceIdEquals)
      if (params.startDateAfter) url.searchParams.set('startDate.gt', params.startDateAfter)
      if (params.startDateBefore) url.searchParams.set('startDate.lt', params.startDateBefore)
      if (params.dueDateAfter) url.searchParams.set('dueDate.gt', params.dueDateAfter)
      if (params.dueDateBefore) url.searchParams.set('dueDate.lt', params.dueDateBefore)
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
    return {
      success: true,
      output: {
        projects: Array.isArray(data?.data) ? data.data.map(mapProject) : [],
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'List of projects',
      items: { type: 'object', properties: PROJECT_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for fetching further pages',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
