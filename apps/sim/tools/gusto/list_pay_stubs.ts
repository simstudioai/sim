import type { GustoListPayStubsParams, GustoPayStubsListResponse } from '@/tools/gusto/types'
import { PAY_STUB_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListPayStubsTool: ToolConfig<GustoListPayStubsParams, GustoPayStubsListResponse> =
  {
    id: 'gusto_list_pay_stubs',
    name: 'Gusto List Pay Stubs',
    description: 'List pay stubs for a Gusto employee',
    version: '1.0.0',

    oauth: { required: true, provider: 'gusto' },

    params: {
      employeeId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Gusto employee UUID',
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
        if (params.page !== undefined) search.set('page', String(params.page))
        if (params.per !== undefined) search.set('per', String(params.per))
        const qs = search.toString()
        return `${GUSTO_API_BASE}/employees/${encodeURIComponent(
          params.employeeId.trim()
        )}/pay_stubs${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => gustoHeaders(params.accessToken),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        return {
          success: false,
          error: gustoErrorMessage(data, 'Failed to list pay stubs'),
          output: {},
        }
      }
      return {
        success: true,
        output: { payStubs: Array.isArray(data) ? data : (data.pay_stubs ?? []) },
      }
    },

    outputs: {
      payStubs: {
        type: 'array',
        description: 'Pay stubs',
        items: { type: 'object', properties: PAY_STUB_OUTPUT_PROPERTIES },
      },
    },
  }
