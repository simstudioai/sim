import type { GustoContractorRecordResponse, GustoGetContractorParams } from '@/tools/gusto/types'
import { CONTRACTOR_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoGetContractorTool: ToolConfig<
  GustoGetContractorParams,
  GustoContractorRecordResponse
> = {
  id: 'gusto_get_contractor',
  name: 'Gusto Get Contractor',
  description: 'Retrieve a Gusto contractor by ID',
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
      `${GUSTO_API_BASE}/contractors/${encodeURIComponent(params.contractorId.trim())}`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to get contractor'),
        output: {},
      }
    }
    return { success: true, output: { contractor: data } }
  },

  outputs: {
    contractor: {
      type: 'object',
      description: 'Gusto contractor',
      properties: CONTRACTOR_OUTPUT_PROPERTIES,
    },
  },
}
