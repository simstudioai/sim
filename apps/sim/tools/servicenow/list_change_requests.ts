import {
  CHANGE_STATE,
  DEFAULT_DISPLAY_VALUE,
  SERVICENOW_TABLES,
} from '@/tools/servicenow/constants'
import { authParams, listParams, recordListOutputs } from '@/tools/servicenow/params'
import type {
  ServiceNowListChangesParams,
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

export const listChangeRequestsTool: ToolConfig<
  ServiceNowListChangesParams,
  ServiceNowRecordListResponse
> = {
  id: 'servicenow_list_change_requests',
  name: 'List ServiceNow Change Requests',
  description:
    'Search ServiceNow change requests by state, type, risk, assignment, or text. All filters are ANDed together.',
  version: '1.0.0',

  params: {
    ...authParams,
    searchText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text to match against the change short description using the ServiceNow LIKE operator, which matches anywhere in the field.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Change state coded value. Base system: ${CHANGE_STATE.NEW}=New, ${CHANGE_STATE.ASSESS}=Assess, ${CHANGE_STATE.AUTHORIZE}=Authorize, ${CHANGE_STATE.SCHEDULED}=Scheduled, ${CHANGE_STATE.IMPLEMENT}=Implement, ${CHANGE_STATE.REVIEW}=Review, ${CHANGE_STATE.CLOSED}=Closed, ${CHANGE_STATE.CANCELED}=Canceled.`,
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Change type: "normal", "standard", or "emergency".',
    },
    risk: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Risk coded value. The choice list is configured per instance.',
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
    active: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to active ("true") or inactive ("false") change requests.',
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
            ['type', '=', params.type],
            ['risk', '=', params.risk],
            ['assignment_group', '=', params.assignmentGroup],
            ['assigned_to', '=', params.assignedTo],
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
      return withQueryString(
        `${baseUrl}/api/now/table/${SERVICENOW_TABLES.CHANGE_REQUEST}`,
        searchParams
      )
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordListResponse,

  outputs: recordListOutputs,
}
