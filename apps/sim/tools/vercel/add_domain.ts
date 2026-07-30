import type { ToolConfig } from '@/tools/types'
import type { VercelAddDomainParams, VercelAddDomainResponse } from '@/tools/vercel/types'

export const vercelAddDomainTool: ToolConfig<VercelAddDomainParams, VercelAddDomainResponse> = {
  id: 'vercel_add_domain',
  name: 'Vercel Add Domain',
  description: 'Add a new domain to a Vercel account or team',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain name to add',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team slug to scope the request (alternative to teamId)',
    },
  },

  request: {
    url: (params: VercelAddDomainParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v7/domains${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelAddDomainParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelAddDomainParams) => ({
      method: 'add',
      name: params.name.trim(),
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
        serviceType: d.serviceType ?? null,
        nameservers: d.nameservers ?? [],
        intendedNameservers: d.intendedNameservers ?? [],
        expiresAt: d.expiresAt ?? null,
        customNameservers: d.customNameservers ?? [],
        renew: d.renew ?? null,
        boughtAt: d.boughtAt ?? null,
        transferredAt: d.transferredAt ?? null,
        creator: d.creator
          ? {
              id: d.creator.id ?? null,
              username: d.creator.username ?? null,
              email: d.creator.email ?? null,
            }
          : null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Domain ID' },
    name: { type: 'string', description: 'Domain name' },
    verified: { type: 'boolean', description: 'Whether domain is verified' },
    createdAt: { type: 'number', description: 'Creation timestamp' },
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
    expiresAt: { type: 'number', description: 'Expiration timestamp', optional: true },
    customNameservers: {
      type: 'array',
      description: 'Custom nameservers',
      items: { type: 'string' },
      optional: true,
    },
    renew: { type: 'boolean', description: 'Whether auto-renewal is enabled', optional: true },
    boughtAt: { type: 'number', description: 'Purchase timestamp', optional: true },
    transferredAt: { type: 'number', description: 'Transfer completion timestamp', optional: true },
    creator: {
      type: 'object',
      description: 'Domain creator (id, username, email)',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Creator ID' },
        username: { type: 'string', description: 'Creator username' },
        email: { type: 'string', description: 'Creator email' },
      },
    },
  },
}
