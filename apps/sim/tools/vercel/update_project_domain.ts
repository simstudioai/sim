import type { ToolConfig } from '@/tools/types'
import type {
  VercelUpdateProjectDomainParams,
  VercelUpdateProjectDomainResponse,
} from '@/tools/vercel/types'

export const vercelUpdateProjectDomainTool: ToolConfig<
  VercelUpdateProjectDomainParams,
  VercelUpdateProjectDomainResponse
> = {
  id: 'vercel_update_project_domain',
  name: 'Vercel Update Project Domain',
  description: "Update a project domain's configuration on Vercel",
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
      description: 'Domain name to update',
    },
    redirect: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target destination domain for redirect',
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
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team slug to scope the request (alternative to teamId)',
    },
  },

  request: {
    url: (params: VercelUpdateProjectDomainParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v9/projects/${params.projectId.trim()}/domains/${params.domain.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'PATCH',
    headers: (params: VercelUpdateProjectDomainParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelUpdateProjectDomainParams) => {
      const body: Record<string, unknown> = {}
      if (params.redirect) body.redirect = params.redirect.trim()
      if (params.redirectStatusCode) body.redirectStatusCode = Number(params.redirectStatusCode)
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
        projectId: data.projectId,
        verified: data.verified,
        redirect: data.redirect ?? null,
        redirectStatusCode: data.redirectStatusCode ?? null,
        gitBranch: data.gitBranch ?? null,
        verification: data.verification ?? [],
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Domain name' },
    apexName: { type: 'string', description: 'Apex domain name' },
    projectId: { type: 'string', description: 'Project ID the domain belongs to' },
    verified: { type: 'boolean', description: 'Whether the domain is verified' },
    redirect: { type: 'string', description: 'Redirect target domain', optional: true },
    redirectStatusCode: {
      type: 'number',
      description: 'HTTP status code for redirect (301, 302, 307, 308)',
      optional: true,
    },
    gitBranch: { type: 'string', description: 'Git branch for the domain', optional: true },
    verification: {
      type: 'array',
      description: 'Domain verification challenges (type, domain, value, reason)',
      optional: true,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Challenge type' },
          domain: { type: 'string', description: 'Domain to add the record to' },
          value: { type: 'string', description: 'Expected record value' },
          reason: { type: 'string', description: 'Why verification is needed' },
        },
      },
    },
    createdAt: { type: 'number', description: 'Creation timestamp', optional: true },
    updatedAt: { type: 'number', description: 'Last updated timestamp', optional: true },
  },
}
