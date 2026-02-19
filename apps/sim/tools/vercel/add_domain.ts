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
  },

  request: {
    url: (params: VercelAddDomainParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
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
  },
}
