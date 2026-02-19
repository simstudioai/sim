import type { ToolConfig } from '@/tools/types'
import type {
  VercelCreateDeploymentParams,
  VercelCreateDeploymentResponse,
} from '@/tools/vercel/types'

export const vercelCreateDeploymentTool: ToolConfig<
  VercelCreateDeploymentParams,
  VercelCreateDeploymentResponse
> = {
  id: 'vercel_create_deployment',
  name: 'Vercel Create Deployment',
  description: 'Create a new deployment or redeploy an existing one',
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
      description: 'Project name for the deployment',
    },
    project: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project ID (overrides name for project lookup)',
    },
    deploymentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing deployment ID to redeploy',
    },
    target: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target environment: production, staging, or a custom environment identifier',
    },
    gitSource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON string defining the Git Repository source to deploy (e.g. {"type":"github","repo":"owner/repo","ref":"main"})',
    },
    forceNew: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Forces a new deployment even if there is a previous similar deployment (0 or 1)',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelCreateDeploymentParams) => {
      const query = new URLSearchParams()
      if (params.forceNew) query.set('forceNew', params.forceNew)
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v13/deployments${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelCreateDeploymentParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: VercelCreateDeploymentParams) => {
      const body: Record<string, any> = {
        name: params.name.trim(),
      }
      if (params.project) body.project = params.project.trim()
      if (params.deploymentId) body.deploymentId = params.deploymentId.trim()
      if (params.target) body.target = params.target
      if (params.gitSource) {
        try {
          body.gitSource = JSON.parse(params.gitSource)
        } catch {
          body.gitSource = params.gitSource
        }
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        url: data.url ?? '',
        readyState: data.readyState ?? 'QUEUED',
        projectId: data.projectId ?? '',
        createdAt: data.createdAt ?? data.created,
        alias: data.alias ?? [],
        target: data.target ?? null,
        inspectorUrl: data.inspectorUrl ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deployment ID' },
    name: { type: 'string', description: 'Deployment name' },
    url: { type: 'string', description: 'Unique deployment URL' },
    readyState: {
      type: 'string',
      description: 'Deployment ready state: QUEUED, BUILDING, ERROR, INITIALIZING, READY, CANCELED',
    },
    projectId: { type: 'string', description: 'Associated project ID' },
    createdAt: { type: 'number', description: 'Creation timestamp in milliseconds' },
    alias: {
      type: 'array',
      description: 'Assigned aliases',
      items: { type: 'string', description: 'Alias domain' },
    },
    target: { type: 'string', description: 'Target environment', optional: true },
    inspectorUrl: { type: 'string', description: 'Vercel inspector URL' },
  },
}
