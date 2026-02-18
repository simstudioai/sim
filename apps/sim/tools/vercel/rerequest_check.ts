import type { ToolConfig } from '@/tools/types'
import type { VercelRerequestCheckParams, VercelRerequestCheckResponse } from '@/tools/vercel/types'

export const vercelRerequestCheckTool: ToolConfig<
  VercelRerequestCheckParams,
  VercelRerequestCheckResponse
> = {
  id: 'vercel_rerequest_check',
  name: 'Vercel Rerequest Check',
  description: 'Rerequest a deployment check',
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
      description: 'Deployment ID the check belongs to',
    },
    checkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Check ID to rerequest',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Team ID to scope the request',
    },
  },

  request: {
    url: (params: VercelRerequestCheckParams) => {
      const query = new URLSearchParams()
      if (params.teamId) query.set('teamId', params.teamId.trim())
      const qs = query.toString()
      return `https://api.vercel.com/v1/deployments/${params.deploymentId.trim()}/checks/${params.checkId.trim()}/rerequest${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params: VercelRerequestCheckParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async () => {
    return {
      success: true,
      output: {
        rerequested: true,
      },
    }
  },

  outputs: {
    rerequested: { type: 'boolean', description: 'Whether the check was successfully rerequested' },
  },
}
