import type {
  RipplingListLeaveBalancesParams,
  RipplingListLeaveBalancesResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListLeaveBalancesTool: ToolConfig<
  RipplingListLeaveBalancesParams,
  RipplingListLeaveBalancesResponse
> = {
  id: 'rippling_list_leave_balances',
  name: 'Rippling List Leave Balances',
  description: 'List leave balances for all employees in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of leave balances to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.limit != null) query.set('limit', String(params.limit))
      if (params.offset != null) query.set('offset', String(params.offset))
      const qs = query.toString()
      return `https://api.rippling.com/platform/api/leave_balances${qs ? `?${qs}` : ''}`
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

    const leaveBalances = results.map((bal: Record<string, unknown>) => ({
      employeeId: (bal.employeeId as string) ?? '',
      balances: (Array.isArray(bal.balances) ? bal.balances : []).map(
        (b: Record<string, unknown>) => ({
          leaveType: (b.leaveType as string) ?? '',
          minutesRemaining: (b.minutesRemaining as number) ?? 0,
        })
      ),
    }))

    return {
      success: true,
      output: {
        leaveBalances,
        totalCount: leaveBalances.length,
      },
    }
  },

  outputs: {
    leaveBalances: {
      type: 'array',
      description: 'List of employee leave balances',
      items: {
        type: 'json',
        properties: {
          employeeId: { type: 'string', description: 'Employee ID' },
          balances: {
            type: 'array',
            description: 'Leave balance entries',
            items: {
              type: 'json',
              properties: {
                leaveType: { type: 'string', description: 'Type of leave' },
                minutesRemaining: { type: 'number', description: 'Minutes of leave remaining' },
              },
            },
          },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of leave balances returned on this page',
    },
  },
}
