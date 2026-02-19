import type { ToolConfig } from '@/tools/types'
import type {
  VercelDeleteDeploymentParams,
  VercelDeleteDeploymentResponse,
} from '@/tools/vercel/types'

export const vercelDeleteDeploymentTool: ToolConfig<
  VercelDeleteDeploymentParams,
  VercelDeleteDeploymentResponse
> = {
  id: 'vercel_delete_deployment',
  name: 'Vercel Delete Deployment',
  description: 'Delete a Vercel deployment',
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
      description: 'The deployment ID or URL to delete',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelDeleteDeploymentParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const id = params.deploymentId.trim()
      if (id.includes('.')) {
        query.set('url', id)
      }
      const qs = query.toString()
      return `https://api.vercel.com/v13/deployments/${id}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
    headers: (params: VercelDeleteDeploymentParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        uid: data.uid ?? data.id ?? null,
        state: data.state ?? 'DELETED',
      },
    }
  },

  outputs: {
    uid: {
      type: 'string',
      description: 'The removed deployment ID',
    },
    state: {
      type: 'string',
      description: 'Deployment state after deletion (DELETED)',
    },
  },
}
