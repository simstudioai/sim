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
  ServiceNowUpdateIncidentParams,
} from '@/tools/servicenow/types'
import {
  buildFieldPayload,
  buildServiceNowHeaders,
  buildTableRecordUrl,
  transformRecordResponse,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const updateIncidentTool: ToolConfig<
  ServiceNowUpdateIncidentParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_update_incident',
  name: 'Update ServiceNow Incident',
  description:
    'Update fields on an existing ServiceNow incident. Only the fields you supply are changed. Reference fields take sys_ids unless input display value is enabled.',
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
        'Incident state coded value. Base system: 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed, 8=Canceled. Use Resolve or Close ServiceNow Incident for those transitions so the resolution fields are populated.',
    },
    impact: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Impact: 1 (High), 2 (Medium), or 3 (Low).',
    },
    urgency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Urgency: 1 (High), 2 (Medium), or 3 (Low).',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority coded value 1-5 (1 Critical … 5 Planning).',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category.',
    },
    subcategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subcategory.',
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
    cmdbCi: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Configuration item (cmdb_ci) — sys_id of the affected CI.',
    },
    workNotes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal work note to append.',
    },
    comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer-visible additional comment to append.',
    },
    ...additionalFieldsParam,
    ...writeParams,
  },

  request: {
    url: (params) => buildTableRecordUrl(params, SERVICENOW_TABLES.INCIDENT),
    method: 'PATCH',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) =>
      buildFieldPayload(
        {
          short_description: params.shortDescription,
          description: params.description,
          state: params.state,
          impact: params.impact,
          urgency: params.urgency,
          priority: params.priority,
          category: params.category,
          subcategory: params.subcategory,
          assignment_group: params.assignmentGroup,
          assigned_to: params.assignedTo,
          cmdb_ci: params.cmdbCi,
          work_notes: params.workNotes,
          comments: params.comments,
        },
        params.additionalFields
      ),
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
