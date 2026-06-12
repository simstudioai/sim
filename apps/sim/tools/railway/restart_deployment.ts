import type {
  RailwayRestartDeploymentParams,
  RailwayRestartDeploymentResponse,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayRestartDeploymentData {
  deploymentRestart?: boolean
}

export const railwayRestartDeploymentTool: ToolConfig<
  RailwayRestartDeploymentParams,
  RailwayRestartDeploymentResponse
> = {
  id: 'railway_restart_deployment',
  name: 'Railway Restart Deployment',
  description: 'Restart a running Railway deployment without rebuilding',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Railway API token',
    },
    tokenType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Railway token type. Use "account" for account, workspace, or OAuth tokens, or "project" for project tokens.',
    },
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway deployment ID',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation RestartDeployment($id: String!) {
          deploymentRestart(id: $id)
        }
      `,
      variables: {
        id: params.deploymentId.trim(),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayRestartDeploymentData>(response)
    if (typeof data.data?.deploymentRestart !== 'boolean') {
      throw new Error('Railway did not return a deployment restart result')
    }

    return {
      success: true,
      output: {
        success: data.data.deploymentRestart,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the deployment was restarted',
    },
  },
}
