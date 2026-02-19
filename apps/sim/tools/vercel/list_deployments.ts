import type { ToolConfig } from '@/tools/types'
import type {
  VercelListDeploymentsParams,
  VercelListDeploymentsResponse,
} from '@/tools/vercel/types'

export const vercelListDeploymentsTool: ToolConfig<
  VercelListDeploymentsParams,
  VercelListDeploymentsResponse
> = {
  id: 'vercel_list_deployments',
  name: 'Vercel List Deployments',
  description: 'List deployments for a Vercel project or team',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter deployments by project ID or name',
    },
    target: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by environment: production or staging',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by state: BUILDING, ERROR, INITIALIZING, QUEUED, READY, CANCELED',
    },
    app: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by deployment name',
    },
    since: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Get deployments created after this JavaScript timestamp',
    },
    until: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Get deployments created before this JavaScript timestamp',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of deployments to return per request',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelListDeploymentsParams) => {
      const query = new URLSearchParams()
      if (params.projectId) query.set('projectId', params.projectId.trim())
      if (params.target) query.set('target', params.target)
      if (params.state) query.set('state', params.state)
      if (params.app) query.set('app', params.app.trim())
      if (params.since) query.set('since', String(params.since))
      if (params.until) query.set('until', String(params.until))
      if (params.limit) query.set('limit', String(params.limit))
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v6/deployments${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params: VercelListDeploymentsParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const deployments = (data.deployments ?? []).map((d: any) => ({
      uid: d.uid,
      name: d.name,
      url: d.url ?? null,
      state: d.state ?? d.readyState ?? 'UNKNOWN',
      target: d.target ?? null,
      created: d.created ?? d.createdAt,
      projectId: d.projectId ?? '',
      source: d.source ?? '',
      inspectorUrl: d.inspectorUrl ?? '',
      creator: {
        uid: d.creator?.uid ?? '',
        email: d.creator?.email ?? '',
        username: d.creator?.username ?? '',
      },
      meta: d.meta ?? {},
    }))

    return {
      success: true,
      output: {
        deployments,
        count: deployments.length,
        hasMore: data.pagination?.next != null,
      },
    }
  },

  outputs: {
    deployments: {
      type: 'array',
      description: 'List of deployments',
      items: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'Unique deployment identifier' },
          name: { type: 'string', description: 'Deployment name' },
          url: { type: 'string', description: 'Deployment URL', optional: true },
          state: {
            type: 'string',
            description:
              'Deployment state: BUILDING, ERROR, INITIALIZING, QUEUED, READY, CANCELED, DELETED',
          },
          target: { type: 'string', description: 'Target environment', optional: true },
          created: { type: 'number', description: 'Creation timestamp' },
          projectId: { type: 'string', description: 'Associated project ID' },
          source: {
            type: 'string',
            description:
              'Deployment source: api-trigger-git-deploy, cli, clone/repo, git, import, import/repo, redeploy, v0-web',
          },
          inspectorUrl: { type: 'string', description: 'Vercel inspector URL' },
          creator: {
            type: 'object',
            description: 'Creator information',
            properties: {
              uid: { type: 'string', description: 'Creator user ID' },
              email: { type: 'string', description: 'Creator email' },
              username: { type: 'string', description: 'Creator username' },
            },
          },
          meta: { type: 'object', description: 'Git provider metadata (key-value strings)' },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of deployments returned',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more deployments are available',
    },
  },
}
