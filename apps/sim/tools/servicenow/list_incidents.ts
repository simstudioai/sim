import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import { authParams, listParams, recordListOutputs } from '@/tools/servicenow/params'
import type {
  ServiceNowListIncidentsParams,
  ServiceNowRecordListResponse,
} from '@/tools/servicenow/types'
import {
  appendReadParams,
  buildEncodedQuery,
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  transformRecordListResponse,
  withQueryString,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const listIncidentsTool: ToolConfig<
  ServiceNowListIncidentsParams,
  ServiceNowRecordListResponse
> = {
  id: 'servicenow_list_incidents',
  name: 'List ServiceNow Incidents',
  description:
    'Search ServiceNow incidents by state, priority, assignment, caller, or text. All filters are ANDed together.',
  version: '1.0.0',

  params: {
    ...authParams,
    searchText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Text to match against the incident short description using the ServiceNow LIKE operator, which matches anywhere in the field.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Incident state coded value. Base system: 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed, 8=Canceled.',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority coded value 1-5 (1 Critical … 5 Planning).',
    },
    assignmentGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'sys_id of the assignment group.',
    },
    assignedTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'sys_id of the assigned user.',
    },
    callerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'sys_id of the caller.',
    },
    active: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to active ("true") or inactive ("false") incidents.',
    },
    ...listParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const searchParams = new URLSearchParams()
      appendReadParams(searchParams, {
        query: buildEncodedQuery(
          [
            ['state', '=', params.state],
            ['priority', '=', params.priority],
            ['assignment_group', '=', params.assignmentGroup],
            ['assigned_to', '=', params.assignedTo],
            ['caller_id', '=', params.callerId],
            ['active', '=', params.active],
            ['short_description', 'LIKE', params.searchText],
          ],
          params.query
        ),
        limit: params.limit,
        offset: params.offset,
        fields: params.fields,
        displayValue: params.displayValue,
        defaultDisplayValue: DEFAULT_DISPLAY_VALUE,
      })
      return withQueryString(`${baseUrl}/api/now/table/${SERVICENOW_TABLES.INCIDENT}`, searchParams)
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordListResponse,

  outputs: recordListOutputs,
}
