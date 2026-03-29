import type {
  RipplingGetLeaveBalanceParams,
  RipplingGetLeaveBalanceResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetLeaveBalanceTool: ToolConfig<
  RipplingGetLeaveBalanceParams,
  RipplingGetLeaveBalanceResponse
> = {
  id: 'rippling_get_leave_balance',
  name: 'Rippling Get Leave Balance',
  description: 'Get leave balance for a specific employee by role ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    roleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The employee/role ID to retrieve leave balance for',
    },
  },

  request: {
    url: (params) =>
      `https://api.rippling.com/platform/api/leave_balances/${encodeURIComponent(params.roleId.trim())}`,
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

    return {
      success: true,
      output: {
        employeeId: data.employeeId ?? '',
        balances: (Array.isArray(data.balances) ? data.balances : []).map(
          (b: Record<string, unknown>) => ({
            leaveType: (b.leaveType as string) ?? '',
            minutesRemaining: (b.minutesRemaining as number) ?? 0,
          })
        ),
      },
    }
  },

  outputs: {
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
}
