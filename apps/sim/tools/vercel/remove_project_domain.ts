import type { ToolConfig } from '@/tools/types'
import type {
  VercelRemoveProjectDomainParams,
  VercelRemoveProjectDomainResponse,
} from '@/tools/vercel/types'

export const vercelRemoveProjectDomainTool: ToolConfig<
  VercelRemoveProjectDomainParams,
  VercelRemoveProjectDomainResponse
> = {
  id: 'vercel_remove_project_domain',
  name: 'Vercel Remove Project Domain',
  description: 'Remove a domain from a Vercel project',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or name',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain name to remove',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelRemoveProjectDomainParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v9/projects/${params.projectId.trim()}/domains/${params.domain.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params: VercelRemoveProjectDomainParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the domain was successfully removed' },
  },
}
