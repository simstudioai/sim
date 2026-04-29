import type { GustoListContractorsParams, GustoListContractorsResponse } from '@/tools/gusto/types'
import { CONTRACTOR_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListContractorsTool: ToolConfig<
  GustoListContractorsParams,
  GustoListContractorsResponse
> = {
  id: 'gusto_list_contractors',
  name: 'Gusto List Contractors',
  description: 'List contractors for a Gusto company',
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
    searchTerm: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter contractors by name',
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
      if (params.searchTerm) search.set('search_term', params.searchTerm)
      if (params.page !== undefined) search.set('page', String(params.page))
      if (params.per !== undefined) search.set('per', String(params.per))
      const qs = search.toString()
      return `${GUSTO_API_BASE}/companies/${encodeURIComponent(
        params.companyId.trim()
      )}/contractors${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list contractors'),
        output: {},
      }
    }
    return {
      success: true,
      output: { contractors: Array.isArray(data) ? data : (data.contractors ?? []) },
    }
  },

  outputs: {
    contractors: {
      type: 'array',
      description: 'List of contractors',
      items: {
        type: 'object',
        properties: CONTRACTOR_OUTPUT_PROPERTIES,
      },
    },
  },
}
