import type { ToolConfig } from '@/tools/types'
import type {
  VercelAddProjectDomainParams,
  VercelAddProjectDomainResponse,
} from '@/tools/vercel/types'

export const vercelAddProjectDomainTool: ToolConfig<
  VercelAddProjectDomainParams,
  VercelAddProjectDomainResponse
> = {
  id: 'vercel_add_project_domain',
  name: 'Vercel Add Project Domain',
  description: 'Add a domain to a Vercel project',
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
      description: 'Domain name to add',
    },
    redirect: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target domain for redirect',
    },
    redirectStatusCode: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTTP status code for redirect (301, 302, 307, 308)',
    },
    gitBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Git branch to link the domain to',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelAddProjectDomainParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v10/projects/${params.projectId.trim()}/domains${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelAddProjectDomainParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelAddProjectDomainParams) => {
      const body: Record<string, unknown> = { name: params.domain.trim() }
      if (params.redirect) body.redirect = params.redirect.trim()
      if (params.redirectStatusCode) body.redirectStatusCode = params.redirectStatusCode
      if (params.gitBranch) body.gitBranch = params.gitBranch.trim()
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        name: data.name,
        apexName: data.apexName,
        verified: data.verified,
        gitBranch: data.gitBranch ?? null,
        redirect: data.redirect ?? null,
        redirectStatusCode: data.redirectStatusCode ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Domain name' },
    apexName: { type: 'string', description: 'Apex domain name' },
    verified: { type: 'boolean', description: 'Whether the domain is verified' },
    gitBranch: { type: 'string', description: 'Git branch for the domain', optional: true },
    redirect: { type: 'string', description: 'Redirect target domain', optional: true },
    redirectStatusCode: {
      type: 'number',
      description: 'HTTP status code for redirect (301, 302, 307, 308)',
      optional: true,
    },
    createdAt: { type: 'number', description: 'Creation timestamp' },
    updatedAt: { type: 'number', description: 'Last updated timestamp' },
  },
}
