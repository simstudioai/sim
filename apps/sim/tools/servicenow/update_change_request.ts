import { SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
  additionalFieldsParam,
  authParams,
  recordOutputs,
  requiredSysIdParam,
  writeParams,
} from '@/tools/servicenow/params'
import type {
  ServiceNowSingleRecordResponse,
  ServiceNowUpdateChangeParams,
} from '@/tools/servicenow/types'
import {
  buildFieldPayload,
  buildServiceNowHeaders,
  buildTableRecordUrl,
  transformRecordResponse,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const updateChangeRequestTool: ToolConfig<
  ServiceNowUpdateChangeParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_update_change_request',
  name: 'Update ServiceNow Change Request',
  description:
    'Update fields on an existing ServiceNow change request. Only the fields you supply are changed. Use Move ServiceNow Change State for state transitions.',
  version: '1.0.0',

  params: {
    ...authParams,
    ...requiredSysIdParam,
    shortDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New short description.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New detailed description.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Change state coded value. Base system: -5=New, -4=Assess, -3=Authorize, -2=Scheduled, -1=Implement, 0=Review, 3=Closed, 4=Canceled.',
    },
    risk: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Risk coded value. The choice list is configured per instance.',
    },
    impact: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Impact: 1 (High), 2 (Medium), or 3 (Low).',
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
      description: 'Assignment group (assignment_group) — sys_id of the sys_user_group.',
    },
    assignedTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assigned to (assigned_to) — sys_id of the sys_user.',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned start date (start_date) as "YYYY-MM-DD HH:mm:ss" in UTC.',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Planned end date (end_date) as "YYYY-MM-DD HH:mm:ss" in UTC.',
    },
    closeCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Close code: "successful", "successful_issues", or "unsuccessful". Required when closing a change.',
    },
    closeNotes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Close notes describing the outcome of the change.',
    },
    workNotes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal work note to append.',
    },
    ...additionalFieldsParam,
    ...writeParams,
  },

  request: {
    url: (params) => buildTableRecordUrl(params, SERVICENOW_TABLES.CHANGE_REQUEST),
    method: 'PATCH',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) =>
      buildFieldPayload(
        {
          short_description: params.shortDescription,
          description: params.description,
          state: params.state,
          risk: params.risk,
          impact: params.impact,
          priority: params.priority,
          assignment_group: params.assignmentGroup,
          assigned_to: params.assignedTo,
          start_date: params.startDate,
          end_date: params.endDate,
          close_code: params.closeCode,
          close_notes: params.closeNotes,
          work_notes: params.workNotes,
        },
        params.additionalFields
      ),
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
