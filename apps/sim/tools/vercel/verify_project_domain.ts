import type { ToolConfig } from '@/tools/types'
import type {
  VercelVerifyProjectDomainParams,
  VercelVerifyProjectDomainResponse,
} from '@/tools/vercel/types'

export const vercelVerifyProjectDomainTool: ToolConfig<
  VercelVerifyProjectDomainParams,
  VercelVerifyProjectDomainResponse
> = {
  id: 'vercel_verify_project_domain',
  name: 'Vercel Verify Project Domain',
  description: 'Verify a Vercel project domain by checking its verification challenge',
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
      description: 'Domain name to verify',
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
    url: (params: VercelVerifyProjectDomainParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v9/projects/${params.projectId.trim()}/domains/${params.domain.trim()}/verify${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelVerifyProjectDomainParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))
    return {
      success: true,
      output: {
        name: data.name ?? null,
        apexName: data.apexName ?? null,
        projectId: data.projectId ?? null,
        verified: data.verified ?? false,
        redirect: data.redirect ?? null,
        redirectStatusCode: data.redirectStatusCode ?? null,
        gitBranch: data.gitBranch ?? null,
        createdAt: data.createdAt ?? null,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Domain name' },
    apexName: { type: 'string', description: 'Apex domain name' },
    projectId: { type: 'string', description: 'Project ID' },
    verified: { type: 'boolean', description: 'Whether the domain is verified' },
    redirect: { type: 'string', description: 'Redirect target domain', optional: true },
    redirectStatusCode: {
      type: 'number',
      description: 'Redirect status code (301, 302, 307, 308)',
      optional: true,
    },
    gitBranch: { type: 'string', description: 'Git branch linked to the domain', optional: true },
    createdAt: { type: 'number', description: 'Creation timestamp', optional: true },
    updatedAt: { type: 'number', description: 'Last update timestamp', optional: true },
  },
}
