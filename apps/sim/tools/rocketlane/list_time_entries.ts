import {
  mapPagination,
  mapTimeEntry,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListTimeEntriesParams,
  type RocketlaneTimeEntryListResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TIME_ENTRY_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListTimeEntriesTool: ToolConfig<
  RocketlaneListTimeEntriesParams,
  RocketlaneTimeEntryListResponse
> = {
  id: 'rocketlane_list_time_entries',
  name: 'Rocketlane List Time Entries',
  description:
    'List Rocketlane time entries with optional filters, sorting, and cursor-based pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    dateEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries on this exact date (YYYY-MM-DD)',
    },
    dateGt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries after this date (YYYY-MM-DD)',
    },
    dateGe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries on or after this date (YYYY-MM-DD)',
    },
    dateLt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries before this date (YYYY-MM-DD)',
    },
    dateLe: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries on or before this date (YYYY-MM-DD)',
    },
    projectIdEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries for this project ID',
    },
    taskIdEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries for this task ID',
    },
    projectPhaseIdEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries for this project phase ID',
    },
    categoryIdEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries with this category ID',
    },
    userIdEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries belonging to this user ID',
    },
    emailIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries belonging to the user with this exact email',
    },
    emailIdCn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries whose user email contains this text',
    },
    sourceTypeEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only entries with this source type (GOOGLE_CALENDAR, OUTLOOK_CALENDAR, TASK, PROJECT, PHASE, ADHOC, MILESTONE)',
    },
    activityNameEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries with this exact activity name',
    },
    activityNameCn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries whose activity name contains this text',
    },
    approvalStatusEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only entries with this approval status (NOT_SUBMITTED, SUBMITTED, APPROVED, REJECTED)',
    },
    billableEq: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only billable (true) or non-billable (false) entries',
    },
    includeDeletedEq: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether deleted time entries are included in the response',
    },
    submittedByEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries submitted by this user ID',
    },
    approvedByEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries approved by this user ID',
    },
    rejectedByEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries rejected by this user ID',
    },
    createdAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries created after this epoch-millisecond timestamp',
    },
    createdAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries created before this epoch-millisecond timestamp',
    },
    updatedAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries updated after this epoch-millisecond timestamp',
    },
    updatedAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only entries updated before this epoch-millisecond timestamp',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How to combine filters: all (AND, default) or any (OR)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by (minutes, date, id, billable)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: ASC or DESC (default DESC)',
    },
    includeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra fields to include in the response (notes, sourceType, deleted, status, submittedBy, submittedAt, approvedBy, approvedAt, rejectedBy, rejectedAt, costRate, billRate)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of entries per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response for fetching the next page',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/time-entries`)
      if (params.dateEq) url.searchParams.set('date.eq', params.dateEq)
      if (params.dateGt) url.searchParams.set('date.gt', params.dateGt)
      if (params.dateGe) url.searchParams.set('date.ge', params.dateGe)
      if (params.dateLt) url.searchParams.set('date.lt', params.dateLt)
      if (params.dateLe) url.searchParams.set('date.le', params.dateLe)
      if (params.projectIdEq != null) {
        url.searchParams.set('projectId.eq', String(params.projectIdEq))
      }
      if (params.taskIdEq != null) url.searchParams.set('taskId.eq', String(params.taskIdEq))
      if (params.projectPhaseIdEq != null) {
        url.searchParams.set('projectPhase.eq', String(params.projectPhaseIdEq))
      }
      if (params.categoryIdEq != null) {
        url.searchParams.set('category.eq', String(params.categoryIdEq))
      }
      if (params.userIdEq != null) url.searchParams.set('user.eq', String(params.userIdEq))
      if (params.emailIdEq) url.searchParams.set('emailId.eq', params.emailIdEq)
      if (params.emailIdCn) url.searchParams.set('emailId.cn', params.emailIdCn)
      if (params.sourceTypeEq) url.searchParams.set('sourceType.eq', params.sourceTypeEq)
      if (params.activityNameEq) url.searchParams.set('activityName.eq', params.activityNameEq)
      if (params.activityNameCn) url.searchParams.set('activityName.cn', params.activityNameCn)
      if (params.approvalStatusEq) {
        url.searchParams.set('approvalStatus.eq', params.approvalStatusEq)
      }
      if (params.billableEq != null) {
        url.searchParams.set('billable.eq', String(params.billableEq))
      }
      if (params.includeDeletedEq != null) {
        url.searchParams.set('includeDeleted.eq', String(params.includeDeletedEq))
      }
      if (params.submittedByEq != null) {
        url.searchParams.set('submittedBy.eq', String(params.submittedByEq))
      }
      if (params.approvedByEq != null) {
        url.searchParams.set('approvedBy.eq', String(params.approvedByEq))
      }
      if (params.rejectedByEq != null) {
        url.searchParams.set('rejectedBy.eq', String(params.rejectedByEq))
      }
      if (params.createdAtGt != null) {
        url.searchParams.set('createdAt.gt', String(params.createdAtGt))
      }
      if (params.createdAtLt != null) {
        url.searchParams.set('createdAt.lt', String(params.createdAtLt))
      }
      if (params.updatedAtGt != null) {
        url.searchParams.set('updatedAt.gt', String(params.updatedAtGt))
      }
      if (params.updatedAtLt != null) {
        url.searchParams.set('updatedAt.lt', String(params.updatedAtLt))
      }
      if (params.match) url.searchParams.set('match', params.match)
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
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
    const entries = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        timeEntries: entries.map(mapTimeEntry),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    timeEntries: {
      type: 'array',
      description: 'List of time entries matching the filters',
      items: { type: 'object', properties: TIME_ENTRY_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details for the result set',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
