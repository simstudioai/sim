import type { ToolConfig } from '@/tools/types'
import type {
  VercelCancelDeploymentParams,
  VercelCancelDeploymentResponse,
} from '@/tools/vercel/types'

export const vercelCancelDeploymentTool: ToolConfig<
  VercelCancelDeploymentParams,
  VercelCancelDeploymentResponse
> = {
  id: 'vercel_cancel_deployment',
  name: 'Vercel Cancel Deployment',
  description: 'Cancel a running Vercel deployment',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vercel Access Token',
    },
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The deployment ID to cancel',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelCancelDeploymentParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v12/deployments/${params.deploymentId.trim()}/cancel${qs ? `?${qs}` : ''}`
    },
    method: 'PATCH',
    headers: (params: VercelCancelDeploymentParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? data.uid,
        name: data.name ?? null,
        state: data.readyState ?? data.state ?? 'CANCELED',
        url: data.url ?? null,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Deployment ID',
    },
    name: {
      type: 'string',
      description: 'Deployment name',
    },
    state: {
      type: 'string',
      description: 'Deployment state after cancellation',
    },
    url: {
      type: 'string',
      description: 'Deployment URL',
    },
  },
}
