import type { GustoListEmployeesParams, GustoListEmployeesResponse } from '@/tools/gusto/types'
import { EMPLOYEE_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import type { ToolConfig } from '@/tools/types'

export const gustoListEmployeesTool: ToolConfig<
  GustoListEmployeesParams,
  GustoListEmployeesResponse
> = {
  id: 'gusto_list_employees',
  name: 'Gusto List Employees',
  description: 'List employees for a Gusto company',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'gusto',
  },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    terminated: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include only terminated employees when true',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number',
    },
    per: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Items per page',
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
      const search = new URLSearchParams()
      if (params.terminated !== undefined) search.set('terminated', String(params.terminated))
      if (params.page) search.set('page', String(params.page))
      if (params.per) search.set('per', String(params.per))
      const qs = search.toString()
      return `https://api.gusto.com/v1/companies/${encodeURIComponent(params.companyId)}/employees${
        qs ? `?${qs}` : ''
      }`
    },
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
        error: data.error_description || data.message || 'Failed to list employees',
        output: {},
      }
    }
    return {
      success: true,
      output: { employees: Array.isArray(data) ? data : (data.employees ?? []) },
    }
  },

  outputs: {
    employees: {
      type: 'array',
      description: 'List of employees',
      items: {
        type: 'object',
        properties: EMPLOYEE_OUTPUT_PROPERTIES,
      },
    },
  },
}
