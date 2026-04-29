import type {
  GustoCreateDepartmentParams,
  GustoDepartmentRecordResponse,
} from '@/tools/gusto/types'
import { DEPARTMENT_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoCreateDepartmentTool: ToolConfig<
  GustoCreateDepartmentParams,
  GustoDepartmentRecordResponse
> = {
  id: 'gusto_create_department',
  name: 'Gusto Create Department',
  description: 'Create a department in a Gusto company',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Department title',
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
    method: 'POST',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => ({ title: params.title }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to create department'),
        output: {},
      }
    }
    return { success: true, output: { department: data } }
  },

  outputs: {
    department: {
      type: 'object',
      description: 'Created department',
      properties: DEPARTMENT_OUTPUT_PROPERTIES,
    },
  },
}
