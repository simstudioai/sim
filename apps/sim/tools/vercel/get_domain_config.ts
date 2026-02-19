import type { ToolConfig } from '@/tools/types'
import type {
  VercelGetDomainConfigParams,
  VercelGetDomainConfigResponse,
} from '@/tools/vercel/types'

export const vercelGetDomainConfigTool: ToolConfig<
  VercelGetDomainConfigParams,
  VercelGetDomainConfigResponse
> = {
  id: 'vercel_get_domain_config',
  name: 'Vercel Get Domain Config',
  description: 'Get the configuration for a domain in a Vercel account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain name to get configuration for',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetDomainConfigParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v6/domains/${params.domain.trim()}/config${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetDomainConfigParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const d = await response.json()

    return {
      success: true,
      output: {
        configuredBy: d.configuredBy ?? null,
        acceptedChallenges: d.acceptedChallenges ?? [],
        misconfigured: d.misconfigured ?? false,
        recommendedIPv4: d.recommendedIPv4 ?? [],
        recommendedCNAME: d.recommendedCNAME ?? [],
      },
    }
  },

  outputs: {
    configuredBy: {
      type: 'string',
      description: 'How the domain is configured (CNAME, A, http, dns-01, or null)',
    },
    acceptedChallenges: {
      type: 'array',
      description: 'Accepted challenge types for certificate issuance (dns-01, http-01)',
      items: { type: 'string' },
    },
    misconfigured: {
      type: 'boolean',
      description: 'Whether the domain is misconfigured for TLS certificate generation',
    },
    recommendedIPv4: {
      type: 'array',
      description: 'Recommended IPv4 addresses with rank values',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'number', description: 'Priority rank (1 is preferred)' },
          value: {
            type: 'array',
            description: 'IPv4 addresses',
            items: { type: 'string' },
          },
        },
      },
    },
    recommendedCNAME: {
      type: 'array',
      description: 'Recommended CNAME records with rank values',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'number', description: 'Priority rank (1 is preferred)' },
          value: { type: 'string', description: 'CNAME value' },
        },
      },
    },
  },
}
