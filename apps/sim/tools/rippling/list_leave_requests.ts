import type {
  RipplingListLeaveRequestsParams,
  RipplingListLeaveRequestsResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListLeaveRequestsTool: ToolConfig<
  RipplingListLeaveRequestsParams,
  RipplingListLeaveRequestsResponse
> = {
  id: 'rippling_list_leave_requests',
  name: 'Rippling List Leave Requests',
  description: 'List leave requests in Rippling with optional filtering by date range and status',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by start date (ISO date string)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by end date (ISO date string)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status (e.g. pending, approved, declined)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.startDate) query.set('startDate', params.startDate)
      if (params.endDate) query.set('endDate', params.endDate)
      if (params.status) query.set('status', params.status)
      const qs = query.toString()
      return `https://api.rippling.com/platform/api/leave_requests${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
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
    const results = Array.isArray(data) ? data : (data.results ?? [])

    const leaveRequests = results.map((req: Record<string, unknown>) => ({
      id: (req.id as string) ?? '',
      requestedBy: (req.requestedBy as string) ?? '',
      status: (req.status as string) ?? '',
      startDate: (req.startDate as string) ?? '',
      endDate: (req.endDate as string) ?? '',
      reason: (req.reason as string) ?? null,
      leaveType: (req.leaveType as string) ?? null,
      createdAt: (req.createdAt as string) ?? null,
    }))

    return {
      success: true,
      output: {
        leaveRequests,
        totalCount: leaveRequests.length,
      },
    }
  },

  outputs: {
    leaveRequests: {
      type: 'array',
      description: 'List of leave requests',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Leave request ID' },
          requestedBy: { type: 'string', description: 'Employee ID who requested leave' },
          status: { type: 'string', description: 'Request status (pending/approved/declined)' },
          startDate: { type: 'string', description: 'Leave start date' },
          endDate: { type: 'string', description: 'Leave end date' },
          reason: { type: 'string', description: 'Reason for leave' },
          leaveType: { type: 'string', description: 'Type of leave' },
          createdAt: { type: 'string', description: 'When the request was created' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of leave requests returned',
    },
  },
}
