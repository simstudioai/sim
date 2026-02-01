import type { EnrichEmailToIpParams, EnrichEmailToIpResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const emailToIpTool: ToolConfig<EnrichEmailToIpParams, EnrichEmailToIpResponse> = {
  id: 'enrich_email_to_ip',
  name: 'Enrich Email to IP',
  description: 'Discover an IP address associated with an email address.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address to look up (e.g., john.doe@example.com)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/email-to-ip')
      url.searchParams.append('email', params.email.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const ipData = data.data ?? {}

    return {
      success: true,
      output: {
        email: ipData.email ?? '',
        ip: ipData.ip ?? null,
        found: !!ipData.ip,
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Email address looked up',
    },
    ip: {
      type: 'string',
      description: 'Associated IP address',
      optional: true,
    },
    found: {
      type: 'boolean',
      description: 'Whether an IP address was found',
    },
  },
}
