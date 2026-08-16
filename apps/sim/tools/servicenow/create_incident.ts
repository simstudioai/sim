import { DEFAULT_DISPLAY_VALUE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
  additionalFieldsParam,
  authParams,
  recordOutputs,
  writeParams,
} from '@/tools/servicenow/params'
import type {
  ServiceNowCreateIncidentParams,
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

export const createIncidentTool: ToolConfig<
  ServiceNowCreateIncidentParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_create_incident',
  name: 'Create ServiceNow Incident',
  description:
    'Create an incident in ServiceNow. Reference fields (caller, assignment group, assigned to, configuration item) take sys_ids unless input display value is enabled.',
  version: '1.0.0',

  params: {
    ...authParams,
    shortDescription: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Short description — the one-line summary of the incident.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Detailed description of the incident.',
    },
    callerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Caller (caller_id) — sys_id of the sys_user who reported the incident. Use Find ServiceNow User to resolve an email address to a sys_id.',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category (e.g., inquiry, software, hardware, network, database).',
    },
    subcategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subcategory, valid for the selected category.',
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
      description:
        'Priority 1-5 (1 Critical … 5 Planning). Normally derived from impact and urgency, so prefer setting those.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Incident state coded value. Base system: 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed, 8=Canceled. Defaults to New.',
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
    businessService: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Service (business_service) — sys_id of the affected business service.',
    },
    contactType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Channel (contact_type), e.g., email, phone, self-service, chat.',
    },
    workNotes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Internal work note to record on creation.',
    },
    comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer-visible additional comment to record on creation.',
    },
    ...additionalFieldsParam,
    ...writeParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const searchParams = new URLSearchParams()
      appendWriteParams(searchParams, { ...params, defaultDisplayValue: DEFAULT_DISPLAY_VALUE })
      return withQueryString(`${baseUrl}/api/now/table/${SERVICENOW_TABLES.INCIDENT}`, searchParams)
    },
    method: 'POST',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) =>
      buildFieldPayload(
        {
          short_description: params.shortDescription,
          description: params.description,
          caller_id: params.callerId,
          category: params.category,
          subcategory: params.subcategory,
          impact: params.impact,
          urgency: params.urgency,
          priority: params.priority,
          state: params.state,
          assignment_group: params.assignmentGroup,
          assigned_to: params.assignedTo,
          cmdb_ci: params.cmdbCi,
          business_service: params.businessService,
          contact_type: params.contactType,
          work_notes: params.workNotes,
          comments: params.comments,
        },
        params.additionalFields
      ),
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
