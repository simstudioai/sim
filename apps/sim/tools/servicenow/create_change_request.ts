import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
  additionalFieldsParam,
  authParams,
  recordOutputs,
  writeParams,
} from '@/tools/servicenow/params'
import type {
  ServiceNowCreateChangeParams,
  ServiceNowSingleRecordResponse,
} from '@/tools/servicenow/types'
import {
  appendWriteParams,
  buildFieldPayload,
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  transformRecordResponse,
  withQueryString,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const createChangeRequestTool: ToolConfig<
  ServiceNowCreateChangeParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_create_change_request',
  name: 'Create ServiceNow Change Request',
  description:
    'Create a change request in ServiceNow. Reference fields (assignment group, assigned to, requested by, configuration item) take sys_ids unless input display value is enabled.',
  version: '1.0.0',

  params: {
    ...authParams,
    shortDescription: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Short description — the one-line summary of the change.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detailed description of the change.',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Change type: "normal", "standard", or "emergency".',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Change category.',
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
    requestedBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Requested by (requested_by) — sys_id of the sys_user.',
    },
    cmdbCi: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Configuration item (cmdb_ci) — sys_id of the CI being changed.',
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
    justification: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Justification for making the change.',
    },
    implementationPlan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Implementation plan.',
    },
    backoutPlan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Backout plan.',
    },
    testPlan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Test plan.',
    },
    ...additionalFieldsParam,
    ...writeParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const searchParams = new URLSearchParams()
      appendWriteParams(searchParams, { ...params, defaultDisplayValue: DEFAULT_DISPLAY_VALUE })
      return withQueryString(
        `${baseUrl}/api/now/table/${SERVICENOW_TABLES.CHANGE_REQUEST}`,
        searchParams
      )
    },
    method: 'POST',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) =>
      buildFieldPayload(
        {
          short_description: params.shortDescription,
          description: params.description,
          type: params.type,
          category: params.category,
          risk: params.risk,
          impact: params.impact,
          priority: params.priority,
          assignment_group: params.assignmentGroup,
          assigned_to: params.assignedTo,
          requested_by: params.requestedBy,
          cmdb_ci: params.cmdbCi,
          start_date: params.startDate,
          end_date: params.endDate,
          justification: params.justification,
          implementation_plan: params.implementationPlan,
          backout_plan: params.backoutPlan,
          test_plan: params.testPlan,
        },
        params.additionalFields
      ),
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
