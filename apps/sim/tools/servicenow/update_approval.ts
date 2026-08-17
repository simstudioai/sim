import { APPROVAL_STATE, SERVICENOW_TABLES } from '@/tools/servicenow/constants'
import { authParams, recordOutputs, writeParams } from '@/tools/servicenow/params'
import type {
  ServiceNowSingleRecordResponse,
  ServiceNowUpdateApprovalParams,
} from '@/tools/servicenow/types'
import {
  buildFieldPayload,
  buildServiceNowHeaders,
  buildTableRecordUrl,
  transformRecordResponse,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

const ALLOWED_DECISIONS = new Set<string>([APPROVAL_STATE.APPROVED, APPROVAL_STATE.REJECTED])

export const updateApprovalTool: ToolConfig<
  ServiceNowUpdateApprovalParams,
  ServiceNowSingleRecordResponse
> = {
  id: 'servicenow_update_approval',
  name: 'Approve or Reject ServiceNow Approval',
  description:
    'Approve or reject a ServiceNow approval record by setting its state on the Approval [sysapproval_approver] table.',
  version: '1.0.0',

  params: {
    ...authParams,
    approvalSysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'sys_id of the approval record on the sysapproval_approver table. Use List ServiceNow Approvals to find it.',
    },
    decision: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Decision to record: "approved" or "rejected".',
    },
    comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment to record alongside the decision. This is a journal field.',
    },
    ...writeParams,
  },

  request: {
    url: (params) =>
      buildTableRecordUrl({ ...params, sysId: params.approvalSysId }, SERVICENOW_TABLES.APPROVAL),
    method: 'PATCH',
    headers: (params) => buildServiceNowHeaders(params, { json: true }),
    body: (params) => {
      const decision = String(params.decision ?? '')
        .trim()
        .toLowerCase()
      if (!ALLOWED_DECISIONS.has(decision)) {
        throw new Error(
          `decision must be "${APPROVAL_STATE.APPROVED}" or "${APPROVAL_STATE.REJECTED}"`
        )
      }
      return buildFieldPayload({ state: decision, comments: params.comments })
    },
  },

  transformResponse: transformRecordResponse,

  outputs: recordOutputs,
}
