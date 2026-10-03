import { SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import {
  authParams,
  recordOutputs,
  requiredSysIdParam,
  writeParams,
} from '@/tools/servicenow/params'
import type {
  ServiceNowAddCommentParams,
  ServiceNowSingleRecordResponse,
} from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  buildTableRecordUrl,
  transformRecordResponse,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const addIncidentCommentTool: ToolConfig<
  ServiceNowAddCommentParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_add_incident_comment',
  name: 'Add ServiceNow Incident Comment',
  description:
    'Append an internal work note or a customer-visible additional comment to a ServiceNow incident. Both are journal fields, so the text is appended rather than replacing earlier entries.',
  version: '1.0.0',

  params: {
    ...authParams,
    ...requiredSysIdParam,
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text to append to the journal field.',
    },
    commentField: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Which journal field to write to: "work_notes" for an internal note (default) or "comments" for a customer-visible additional comment.',
    },
    ...writeParams,
  },

  request: {
    url: (params) => buildTableRecordUrl(params, SERVICENOW_TABLES.INCIDENT),
    method: 'PATCH',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) => {
      const comment = params.comment?.trim()
      if (!comment) {
        throw new Error('A comment is required')
      }
      const field = params.commentField === 'comments' ? 'comments' : 'work_notes'
      return { [field]: comment }
    },
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
