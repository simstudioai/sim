import type { GustoGetCompanyParams, GustoGetCompanyResponse } from '@/tools/gusto/types'
import { COMPANY_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import type { ToolConfig } from '@/tools/types'

export const gustoGetCompanyTool: ToolConfig<GustoGetCompanyParams, GustoGetCompanyResponse> = {
  id: 'gusto_get_company',
  name: 'Gusto Get Company',
  description: 'Retrieve a Gusto company by ID',
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
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) => `https://api.gusto.com/v1/companies/${encodeURIComponent(params.companyId)}`,
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
        error: data.error_description || data.message || 'Failed to fetch company',
        output: {},
      }
    }
    return {
      success: true,
      output: { company: data },
    }
  },

  outputs: {
    company: {
      type: 'object',
      description: 'Gusto company',
      properties: COMPANY_OUTPUT_PROPERTIES,
    },
  },
}
