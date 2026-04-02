import type { ToolConfig } from '@/tools/types'
import type { ProfoundListDomainsParams, ProfoundListDomainsResponse } from './types'

export const profoundListDomainsTool: ToolConfig<
  ProfoundListDomainsParams,
  ProfoundListDomainsResponse
> = {
  id: 'profound_list_domains',
  name: 'Profound List Domains',
  description: 'List all organization domains in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/org/domains',
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list domains')
    }
    return {
      success: true,
      output: {
        domains: (data ?? []).map((item: { id: string; name: string; created_at: string }) => ({
          id: item.id ?? null,
          name: item.name ?? null,
          createdAt: item.created_at ?? null,
        })),
      },
    }
  },

  outputs: {
    domains: {
      type: 'json',
      description: 'List of organization domains',
      properties: {
        id: { type: 'string', description: 'Domain ID (UUID)' },
        name: { type: 'string', description: 'Domain name' },
        createdAt: { type: 'string', description: 'When the domain was added' },
      },
    },
  },
}
