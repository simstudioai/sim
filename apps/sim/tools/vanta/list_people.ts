import type { ToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_PERSON_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListPeopleParams, VantaListPeopleResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListPeopleTool: ToolConfig<VantaListPeopleParams, VantaListPeopleResponse> = {
  id: 'vanta_list_people',
  name: 'Vanta List People',
  description:
    'List the people tracked in a Vanta account with employment status, group membership, and security task completion',
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
    emailAndNameFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter people by email address or name',
    },
    employmentStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by employment status: UPCOMING, CURRENT, ON_LEAVE, INACTIVE, or FORMER',
    },
    groupIdsMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated group IDs to filter people by',
    },
    tasksSummaryStatusMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated task summary statuses to filter by: NONE, DUE_SOON, OVERDUE, COMPLETE, PAUSED, OFFBOARDING_DUE_SOON, OFFBOARDING_OVERDUE, OFFBOARDING_COMPLETE',
    },
    taskTypeMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated task types to filter by: COMPLETE_TRAININGS, ACCEPT_POLICIES, COMPLETE_CUSTOM_TASKS, COMPLETE_CUSTOM_OFFBOARDING_TASKS, INSTALL_DEVICE_MONITORING, COMPLETE_BACKGROUND_CHECKS',
    },
    taskStatusMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated task statuses to filter by: COMPLETE, DUE_SOON, OVERDUE, NONE',
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
      operation: 'vanta_list_people',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      emailAndNameFilter: params.emailAndNameFilter,
      employmentStatus: params.employmentStatus,
      groupIdsMatchesAny: params.groupIdsMatchesAny,
      tasksSummaryStatusMatchesAny: params.tasksSummaryStatusMatchesAny,
      taskTypeMatchesAny: params.taskTypeMatchesAny,
      taskStatusMatchesAny: params.taskStatusMatchesAny,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListPeopleResponse>(
    'Failed to list Vanta people'
  ),

  outputs: {
    people: {
      type: 'array',
      description: 'People matching the filters',
      items: { type: 'object', properties: VANTA_PERSON_OUTPUT_PROPERTIES },
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
