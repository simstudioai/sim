import type { GustoFormsListResponse, GustoListContractorFormsParams } from '@/tools/gusto/types'
import { FORM_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListContractorFormsTool: ToolConfig<
  GustoListContractorFormsParams,
  GustoFormsListResponse
> = {
  id: 'gusto_list_contractor_forms',
  name: 'Gusto List Contractor Forms',
  description: 'List forms for a Gusto contractor (1099, etc.)',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    contractorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto contractor UUID',
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
      `${GUSTO_API_BASE}/contractors/${encodeURIComponent(params.contractorId.trim())}/forms`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list contractor forms'),
        output: {},
      }
    }
    return { success: true, output: { forms: Array.isArray(data) ? data : (data.forms ?? []) } }
  },

  outputs: {
    forms: {
      type: 'array',
      description: 'Contractor forms',
      items: { type: 'object', properties: FORM_OUTPUT_PROPERTIES },
    },
  },
}
