import type { GustoJobsListResponse, GustoListEmployeeJobsParams } from '@/tools/gusto/types'
import { JOB_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListEmployeeJobsTool: ToolConfig<
  GustoListEmployeeJobsParams,
  GustoJobsListResponse
> = {
  id: 'gusto_list_employee_jobs',
  name: 'Gusto List Employee Jobs',
  description: 'List jobs (compensations and titles) for a Gusto employee',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    employeeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto employee UUID',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) =>
      `${GUSTO_API_BASE}/employees/${encodeURIComponent(params.employeeId.trim())}/jobs`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list employee jobs'),
        output: {},
      }
    }
    return { success: true, output: { jobs: Array.isArray(data) ? data : (data.jobs ?? []) } }
  },

  outputs: {
    jobs: {
      type: 'array',
      description: 'Employee jobs',
      items: { type: 'object', properties: JOB_OUTPUT_PROPERTIES },
    },
  },
}
