import type { ToolConfig } from '@/tools/types'
import type {
  VercelListProjectDomainsParams,
  VercelListProjectDomainsResponse,
} from '@/tools/vercel/types'

export const vercelListProjectDomainsTool: ToolConfig<
  VercelListProjectDomainsParams,
  VercelListProjectDomainsResponse
> = {
  id: 'vercel_list_project_domains',
  name: 'Vercel List Project Domains',
  description: 'List all domains for a Vercel project',
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
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of domains to return',
    },
  },

  request: {
    url: (params: VercelListProjectDomainsParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.limit) query.set('limit', String(params.limit))
      const qs = query.toString()
      return `https://api.vercel.com/v9/projects/${params.projectId.trim()}/domains${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListProjectDomainsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const domains = (data.domains ?? []).map(
      (d: {
        name: string
        apexName: string
        redirect: string | null
        redirectStatusCode: number | null
        verified: boolean
        gitBranch: string | null
        createdAt: number
        updatedAt: number
      }) => ({
        name: d.name,
        apexName: d.apexName,
        redirect: d.redirect ?? null,
        redirectStatusCode: d.redirectStatusCode ?? null,
        verified: d.verified,
        gitBranch: d.gitBranch ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })
    )
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
      description: 'List of project domains',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Domain name' },
          apexName: { type: 'string', description: 'Apex domain name' },
          redirect: { type: 'string', description: 'Redirect target', optional: true },
          redirectStatusCode: {
            type: 'number',
            description: 'Redirect status code',
            optional: true,
          },
          verified: { type: 'boolean', description: 'Whether the domain is verified' },
          gitBranch: { type: 'string', description: 'Git branch for the domain', optional: true },
          createdAt: { type: 'number', description: 'Creation timestamp' },
          updatedAt: { type: 'number', description: 'Last updated timestamp' },
        },
      },
    },
    count: { type: 'number', description: 'Number of domains returned' },
    hasMore: { type: 'boolean', description: 'Whether more domains are available' },
  },
}
