import type { ToolConfig } from '@/tools/types'
import type { VercelDeleteDomainParams, VercelDeleteDomainResponse } from '@/tools/vercel/types'

export const vercelDeleteDomainTool: ToolConfig<
  VercelDeleteDomainParams,
  VercelDeleteDomainResponse
> = {
  id: 'vercel_delete_domain',
  name: 'Vercel Delete Domain',
  description: 'Delete a domain from a Vercel account or team',
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
      description: 'The domain name to delete',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelDeleteDomainParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v6/domains/${params.domain.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params: VercelDeleteDomainParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const d = await response.json()

    return {
      success: true,
      output: {
        uid: d.uid ?? null,
        deleted: true,
      },
    }
  },

  outputs: {
    uid: { type: 'string', description: 'The ID of the deleted domain' },
    deleted: { type: 'boolean', description: 'Whether the domain was deleted' },
  },
}
