import type { ToolConfig } from '@/tools/types'
import type {
  VercelPromoteDeploymentParams,
  VercelPromoteDeploymentResponse,
} from '@/tools/vercel/types'

export const vercelPromoteDeploymentTool: ToolConfig<
  VercelPromoteDeploymentParams,
  VercelPromoteDeploymentResponse
> = {
  id: 'vercel_promote_deployment',
  name: 'Vercel Promote Deployment',
  description: 'Promote a deployment by pointing the production deployment to the given deployment',
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
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the deployment to promote to production',
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
    url: (params: VercelPromoteDeploymentParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      if (params.slug) query.set('slug', params.slug.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v10/projects/${params.projectId.trim()}/promote/${params.deploymentId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelPromoteDeploymentParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    await response.json().catch(() => ({}))
    return {
      success: true,
      output: {
        promoted: true,
      },
    }
  },

  outputs: {
    promoted: { type: 'boolean', description: 'Whether the deployment was promoted to production' },
  },
}
