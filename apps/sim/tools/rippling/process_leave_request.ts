import type {
  RipplingProcessLeaveRequestParams,
  RipplingProcessLeaveRequestResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingProcessLeaveRequestTool: ToolConfig<
  RipplingProcessLeaveRequestParams,
  RipplingProcessLeaveRequestResponse
> = {
  id: 'rippling_process_leave_request',
  name: 'Rippling Process Leave Request',
  description: 'Approve or decline a leave request in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    leaveRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the leave request to process',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action to take on the leave request (approve or decline)',
    },
  },

  request: {
    url: (params) => {
      const action = params.action.trim()
      if (action !== 'approve' && action !== 'decline') {
        throw new Error(`Invalid action "${action}". Must be "approve" or "decline".`)
      }
      return `https://api.rippling.com/platform/api/leave_requests/${encodeURIComponent(params.leaveRequestId.trim())}/process?action=${encodeURIComponent(action)}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? '',
        status: data.status ?? '',
        requestedBy: data.requestedBy ?? '',
        startDate: data.startDate ?? '',
        endDate: data.endDate ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Leave request ID' },
    status: { type: 'string', description: 'Updated status of the leave request' },
    requestedBy: { type: 'string', description: 'Employee ID who requested leave' },
    startDate: { type: 'string', description: 'Leave start date' },
    endDate: { type: 'string', description: 'Leave end date' },
  },
}
