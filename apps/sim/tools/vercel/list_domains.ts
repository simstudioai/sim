import type { ToolConfig } from '@/tools/types'
import type { VercelListDomainsParams, VercelListDomainsResponse } from '@/tools/vercel/types'

export const vercelListDomainsTool: ToolConfig<VercelListDomainsParams, VercelListDomainsResponse> =
  {
    id: 'vercel_list_domains',
    name: 'Vercel List Domains',
    description: 'List all domains in a Vercel account or team',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Vercel Access Token',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of domains to return (default 20)',
      },
      teamId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Team ID to scope the request',
      },
    },

    request: {
      url: (params: VercelListDomainsParams) => {
        const query = new URLSearchParams()
        if (params.limit) query.set('limit', String(params.limit))
        if (params.teamId) query.set('teamId', params.teamId.trim())
        const qs = query.toString()
        return `https://api.vercel.com/v5/domains${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params: VercelListDomainsParams) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      const domains = (data.domains ?? []).map((d: any) => ({
        id: d.id,
        name: d.name,
        verified: d.verified ?? false,
        createdAt: d.createdAt,
        expiresAt: d.expiresAt ?? null,
        serviceType: d.serviceType ?? 'external',
        nameservers: d.nameservers ?? [],
        intendedNameservers: d.intendedNameservers ?? [],
        renew: d.renew ?? false,
        boughtAt: d.boughtAt ?? null,
      }))

      return {
        success: true,
        output: {
          domains,
          count: domains.length,
          hasMore: data.pagination?.next != null,
        },
      }
    },

    outputs: {
      domains: {
        type: 'array',
        description: 'List of domains',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Domain ID' },
            name: { type: 'string', description: 'Domain name' },
            verified: { type: 'boolean', description: 'Whether domain is verified' },
            createdAt: { type: 'number', description: 'Creation timestamp' },
            expiresAt: { type: 'number', description: 'Expiration timestamp' },
            serviceType: { type: 'string', description: 'Service type (zeit.world, external, na)' },
            nameservers: {
              type: 'array',
              description: 'Current nameservers',
              items: { type: 'string' },
            },
            intendedNameservers: {
              type: 'array',
              description: 'Intended nameservers',
              items: { type: 'string' },
            },
            renew: { type: 'boolean', description: 'Whether auto-renewal is enabled' },
            boughtAt: { type: 'number', description: 'Purchase timestamp' },
          },
        },
      },
      count: {
        type: 'number',
        description: 'Number of domains returned',
      },
      hasMore: {
        type: 'boolean',
        description: 'Whether more domains are available',
      },
    },
  }
