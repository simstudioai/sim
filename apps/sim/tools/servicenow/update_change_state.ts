import { CHANGE_STATE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
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
  description: `Move a ServiceNow change request to another state. Base-system change model states are ${CHANGE_STATE.NEW}=New, ${CHANGE_STATE.ASSESS}=Assess, ${CHANGE_STATE.AUTHORIZE}=Authorize, ${CHANGE_STATE.SCHEDULED}=Scheduled, ${CHANGE_STATE.IMPLEMENT}=Implement, ${CHANGE_STATE.REVIEW}=Review, ${CHANGE_STATE.CLOSED}=Closed, ${CHANGE_STATE.CANCELED}=Canceled. The state machine rejects transitions whose conditions are not met.`,
  version: '1.0.0',

  params: {
    ...authParams,
    ...requiredSysIdParam,
    state: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: `Target state coded value: ${CHANGE_STATE.NEW} (New), ${CHANGE_STATE.ASSESS} (Assess), ${CHANGE_STATE.AUTHORIZE} (Authorize), ${CHANGE_STATE.SCHEDULED} (Scheduled), ${CHANGE_STATE.IMPLEMENT} (Implement), ${CHANGE_STATE.REVIEW} (Review), ${CHANGE_STATE.CLOSED} (Closed), or ${CHANGE_STATE.CANCELED} (Canceled).`,
    },
    closeCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Close code, required when moving to Closed (${CHANGE_STATE.CLOSED}): "successful", "successful_issues", or "unsuccessful".`,
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
      return buildFieldPayload({
        state,
        close_code: params.closeCode,
        close_notes: params.closeNotes,
        work_notes: params.workNotes,
      })
    },
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
