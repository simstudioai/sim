import {
  RB2B_COMPANY_RESULT_OUTPUT_PROPERTIES,
  type Rb2bIpToCompanyParams,
  type Rb2bIpToCompanyResponse,
} from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bIpToCompanyTool: ToolConfig<Rb2bIpToCompanyParams, Rb2bIpToCompanyResponse> = {
  id: 'rb2b_ip_to_company',
  name: 'RB2B IP to Company',
  description: 'Identify the company domains associated with an IP address, ranked by confidence.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
    ip_address: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The IP address to resolve (IPv4 or IPv6)',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/ip_to_company`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => ({ ip_address: params.ip_address }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        results: data.results ?? [],
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Company domain matches for the IP address',
      items: { type: 'object', properties: RB2B_COMPANY_RESULT_OUTPUT_PROPERTIES },
    },
  },
}
