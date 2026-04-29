import type { GustoDepartmentsListResponse, GustoListDepartmentsParams } from '@/tools/gusto/types'
import { DEPARTMENT_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListDepartmentsTool: ToolConfig<
  GustoListDepartmentsParams,
  GustoDepartmentsListResponse
> = {
  id: 'gusto_list_departments',
  name: 'Gusto List Departments',
  description: 'List all departments for a Gusto company',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
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
      `${GUSTO_API_BASE}/companies/${encodeURIComponent(params.companyId.trim())}/departments`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list departments'),
        output: {},
      }
    }
    return {
      success: true,
      output: { departments: Array.isArray(data) ? data : (data.departments ?? []) },
    }
  },

  outputs: {
    departments: {
      type: 'array',
      description: 'Company departments',
      items: { type: 'object', properties: DEPARTMENT_OUTPUT_PROPERTIES },
    },
  },
}
