import type {
  GustoListEmployeeTimeOffActivitiesParams,
  GustoTimeOffActivitiesResponse,
} from '@/tools/gusto/types'
import { TIME_OFF_ACTIVITY_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListEmployeeTimeOffActivitiesTool: ToolConfig<
  GustoListEmployeeTimeOffActivitiesParams,
  GustoTimeOffActivitiesResponse
> = {
  id: 'gusto_list_employee_time_off_activities',
  name: 'Gusto List Employee Time Off Activities',
  description: 'List time off activities for a Gusto employee by time off type',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    employeeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto employee UUID',
    },
    timeOffType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Time off type to query (e.g. 'sick' or 'vacation')",
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) => {
      const search = new URLSearchParams({ time_off_type: params.timeOffType.trim() })
      return `${GUSTO_API_BASE}/employees/${encodeURIComponent(
        params.employeeId.trim()
      )}/time_off_activities?${search.toString()}`
    },
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list time off activities'),
        output: {},
      }
    }
    const activities = Array.isArray(data) ? data : (data.time_off_activities ?? [])
    return { success: true, output: { timeOffActivities: activities } }
  },

  outputs: {
    timeOffActivities: {
      type: 'array',
      description: 'Time off activities',
      items: { type: 'object', properties: TIME_OFF_ACTIVITY_OUTPUT_PROPERTIES },
    },
  },
}
