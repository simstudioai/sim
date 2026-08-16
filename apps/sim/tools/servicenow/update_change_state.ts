import { SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
  additionalFieldsParam,
  authParams,
  recordOutputs,
  requiredSysIdParam,
  writeParams,
} from '@/tools/servicenow/params'
import type {
  ServiceNowChangeStateParams,
  ServiceNowSingleRecordResponse,
} from '@/tools/servicenow/types'
import {
  buildFieldPayload,
  buildServiceNowHeaders,
  buildTableRecordUrl,
  transformRecordResponse,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const updateChangeStateTool: ToolConfig<
  ServiceNowChangeStateParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_update_change_state',
  name: 'Move ServiceNow Change State',
  description:
    'Move a ServiceNow change request to another state. Base-system change model states are -5=New, -4=Assess, -3=Authorize, -2=Scheduled, -1=Implement, 0=Review, 3=Closed, 4=Canceled. The state machine rejects transitions whose conditions are not met.',
  version: '1.0.0',

  params: {
    ...authParams,
    ...requiredSysIdParam,
    state: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Target state coded value: -5 (New), -4 (Assess), -3 (Authorize), -2 (Scheduled), -1 (Implement), 0 (Review), 3 (Closed), or 4 (Canceled).',
    },
    closeCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Close code, required when moving to Closed (3): "successful", "successful_issues", or "unsuccessful".',
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
      description: 'Internal work note explaining the transition.',
    },
    ...additionalFieldsParam,
    ...writeParams,
  },

  request: {
    url: (params) => buildTableRecordUrl(params, SERVICENOW_TABLES.CHANGE_REQUEST),
    method: 'PATCH',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) => {
      const state = String(params.state ?? '').trim()
      if (!state) {
        throw new Error('A target state is required')
      }
      return buildFieldPayload(
        {
          state,
          close_code: params.closeCode,
          close_notes: params.closeNotes,
          work_notes: params.workNotes,
        },
        params.additionalFields
      )
    },
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
