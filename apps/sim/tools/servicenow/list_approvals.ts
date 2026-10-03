import {
  APPROVAL_STATE,
  DEFAULT_DISPLAY_VALUE,
  SERVICENOW_TABLES,
} from '@/tools/servicenow/constants'
import { authParams, listParams, recordListOutputs } from '@/tools/servicenow/params'
import type {
  ServiceNowListApprovalsParams,
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

export const listApprovalsTool: ToolConfig<
  ServiceNowListApprovalsParams,
  ServiceNowRecordListResponse
> = {
  id: 'servicenow_list_approvals',
  name: 'List ServiceNow Approvals',
  description: `List approval records from the ServiceNow Approval [sysapproval_approver] table. Defaults to the "requested" state, which is what a user's pending approvals look like.`,
  version: '1.0.0',

  params: {
    ...authParams,
    approverSysId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'sys_id of the approver (sys_user) whose approvals should be listed. Use Find ServiceNow User to resolve an email address to a sys_id.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Approval state: "requested" (pending, the default), "approved", or "rejected". Pass an empty string with a custom query to list every state.',
    },
    approvalFor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'sys_id of the record being approved, matched against the sysapproval reference field.',
    },
    ...listParams,
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const searchParams = new URLSearchParams()
      const state = params.state === undefined ? APPROVAL_STATE.REQUESTED : params.state

      appendReadParams(searchParams, {
        query: buildEncodedQuery(
          [
            ['approver', '=', params.approverSysId],
            ['state', '=', state],
            ['sysapproval', '=', params.approvalFor],
          ],
          params.query
        ),
        limit: params.limit,
        offset: params.offset,
        fields: params.fields,
        displayValue: params.displayValue,
        defaultDisplayValue: DEFAULT_DISPLAY_VALUE,
      })
      return withQueryString(`${baseUrl}/api/now/table/${SERVICENOW_TABLES.APPROVAL}`, searchParams)
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: transformRecordListResponse,

  outputs: recordListOutputs,
}
