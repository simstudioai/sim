import type { GetDomainParams, GetDomainResult } from '@/tools/mailgun/types'
import type { ToolConfig } from '@/tools/types'

export const mailgunGetDomainTool: ToolConfig<GetDomainParams, GetDomainResult> = {
  id: 'mailgun_get_domain',
  name: 'Mailgun Get Domain',
  description: 'Get details of a specific domain',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailgun API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain name to retrieve details for (e.g., mg.example.com)',
    },
  },

  request: {
    url: (params) => `https://api.mailgun.net/v3/domains/${params.domain}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
    }),
  },

  transformResponse: async (response, params): Promise<GetDomainResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to get domain')
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        success: true,
        domain: {
          name: result.domain.name,
          smtpLogin: result.domain.smtp_login,
          smtpPassword: result.domain.smtp_password,
          spamAction: result.domain.spam_action,
          state: result.domain.state,
          createdAt: result.domain.created_at,
          type: result.domain.type,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the request was successful' },
    domain: { type: 'json', description: 'Domain details' },
  },
}
