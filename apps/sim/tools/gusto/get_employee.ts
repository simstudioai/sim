import type { GustoGetEmployeeParams, GustoGetEmployeeResponse } from '@/tools/gusto/types'
import { EMPLOYEE_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import type { ToolConfig } from '@/tools/types'

export const gustoGetEmployeeTool: ToolConfig<GustoGetEmployeeParams, GustoGetEmployeeResponse> = {
  id: 'gusto_get_employee',
  name: 'Gusto Get Employee',
  description: 'Retrieve a Gusto employee by ID',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'gusto',
  },

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
    url: (params) => `https://api.gusto.com/v1/employees/${encodeURIComponent(params.employeeId)}`,
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Gusto API request')
      }
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Gusto-API-Version': '2026-02-01',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: data.error_description || data.message || 'Failed to fetch employee',
        output: {},
      }
    }
    return {
      success: true,
      output: { employee: data },
    }
  },

  outputs: {
    employee: {
      type: 'object',
      description: 'Gusto employee',
      properties: EMPLOYEE_OUTPUT_PROPERTIES,
    },
  },
}
