import type {
  RailwayRollbackDeploymentParams,
  RailwayRollbackDeploymentResponse,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayRollbackDeploymentData {
  deploymentRollback?: boolean
}

export const railwayRollbackDeploymentTool: ToolConfig<
  RailwayRollbackDeploymentParams,
  RailwayRollbackDeploymentResponse
> = {
  id: 'railway_rollback_deployment',
  name: 'Railway Rollback Deployment',
  description: 'Roll a Railway service back to a previous deployment',
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
      description: 'Railway deployment ID to roll back to (must have canRollback)',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation RollbackDeployment($id: String!) {
          deploymentRollback(id: $id)
        }
      `,
      variables: {
        id: params.deploymentId.trim(),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayRollbackDeploymentData>(response)
    if (typeof data.data?.deploymentRollback !== 'boolean') {
      throw new Error('Railway did not return a rollback result')
    }

    return {
      success: true,
      output: {
        success: data.data.deploymentRollback,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the rollback was triggered',
    },
  },
}
