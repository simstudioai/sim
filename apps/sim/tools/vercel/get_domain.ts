import type { ToolConfig } from '@/tools/types'
import type { VercelGetDomainParams, VercelGetDomainResponse } from '@/tools/vercel/types'

export const vercelGetDomainTool: ToolConfig<VercelGetDomainParams, VercelGetDomainResponse> = {
  id: 'vercel_get_domain',
  name: 'Vercel Get Domain',
  description: 'Get information about a specific domain in a Vercel account',
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
      description: 'The domain name to retrieve',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelGetDomainParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v5/domains/${params.domain.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelGetDomainParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const d = data.domain ?? data

    return {
      success: true,
      output: {
        id: d.id ?? null,
        name: d.name ?? null,
        verified: d.verified ?? false,
        createdAt: d.createdAt ?? null,
        expiresAt: d.expiresAt ?? null,
        serviceType: d.serviceType ?? null,
        nameservers: d.nameservers ?? [],
        intendedNameservers: d.intendedNameservers ?? [],
        customNameservers: d.customNameservers ?? [],
        renew: d.renew ?? false,
        boughtAt: d.boughtAt ?? null,
        transferredAt: d.transferredAt ?? null,
      },
    }
  },

  outputs: {
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
    customNameservers: {
      type: 'array',
      description: 'Custom nameservers',
      items: { type: 'string' },
    },
    renew: { type: 'boolean', description: 'Whether auto-renewal is enabled' },
    boughtAt: { type: 'number', description: 'Purchase timestamp' },
    transferredAt: { type: 'number', description: 'Transfer completion timestamp' },
  },
}
