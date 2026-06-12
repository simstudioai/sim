import {
  RB2B_MAID_RESULT_OUTPUT_PROPERTIES,
  type Rb2bIpToMaidParams,
  type Rb2bMaidResponse,
} from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bIpToMaidTool: ToolConfig<Rb2bIpToMaidParams, Rb2bMaidResponse> = {
  id: 'rb2b_ip_to_maid',
  name: 'RB2B IP to MAID',
  description:
    'Resolve an IP address (and optional user agent) into mobile advertising identifiers (MAIDs) observed over the last 60 days.',
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
    user_agent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional user agent string to improve match accuracy',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/ip_to_maid`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, any> = { ip_address: params.ip_address }
      if (params.user_agent) body.user_agent = params.user_agent
      return body
    },
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
      description: 'Mobile advertising identifiers observed for the IP address',
      items: { type: 'object', properties: RB2B_MAID_RESULT_OUTPUT_PROPERTIES },
    },
  },
}
