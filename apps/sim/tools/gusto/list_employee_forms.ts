import type { GustoFormsListResponse, GustoListEmployeeFormsParams } from '@/tools/gusto/types'
import { FORM_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListEmployeeFormsTool: ToolConfig<
  GustoListEmployeeFormsParams,
  GustoFormsListResponse
> = {
  id: 'gusto_list_employee_forms',
  name: 'Gusto List Employee Forms',
  description: 'List forms for a Gusto employee (W-2, I-9, etc.)',
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
      `${GUSTO_API_BASE}/employees/${encodeURIComponent(params.employeeId.trim())}/forms`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list employee forms'),
        output: {},
      }
    }
    return { success: true, output: { forms: Array.isArray(data) ? data : (data.forms ?? []) } }
  },

  outputs: {
    forms: {
      type: 'array',
      description: 'Employee forms',
      items: { type: 'object', properties: FORM_OUTPUT_PROPERTIES },
    },
  },
}
