import { INCIDENT_STATE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
  additionalFieldsParam,
  authParams,
  recordOutputs,
  requiredSysIdParam,
  writeParams,
} from '@/tools/servicenow/params'
import type {
  ServiceNowResolveIncidentParams,
  ServiceNowSingleRecordResponse,
} from '@/tools/servicenow/types'
import {
  buildFieldPayload,
  buildServiceNowHeaders,
  buildTableRecordUrl,
  transformRecordResponse,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const resolveIncidentTool: ToolConfig<
  ServiceNowResolveIncidentParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_resolve_incident',
  name: 'Resolve ServiceNow Incident',
  description:
    'Move a ServiceNow incident to Resolved (state 6) with a resolution code and resolution notes.',
  version: '1.0.0',

  params: {
    ...authParams,
    ...requiredSysIdParam,
    closeCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Resolution code (close_code). This is a choice field whose values are configured per instance — read the choice list on your incident table and pass one of its values.',
    },
    closeNotes: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Resolution notes (close_notes) documenting how the incident was resolved.',
    },
    workNotes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional internal work note to append.',
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
          state: INCIDENT_STATE.RESOLVED,
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
