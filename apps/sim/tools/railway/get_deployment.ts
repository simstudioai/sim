import type {
  RailwayDeploymentDetail,
  RailwayGetDeploymentParams,
  RailwayGetDeploymentResponse,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayGetDeploymentData {
  deployment?: {
    id: string
    status: string
    createdAt: string
    url?: string | null
    staticUrl?: string | null
    canRollback?: boolean | null
    canRedeploy?: boolean | null
  }
}

export const railwayGetDeploymentTool: ToolConfig<
  RailwayGetDeploymentParams,
  RailwayGetDeploymentResponse
> = {
  id: 'railway_get_deployment',
  name: 'Railway Get Deployment',
  description: 'Get details for a single Railway deployment',
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
        query GetDeployment($id: String!) {
          deployment(id: $id) {
            id
            status
            createdAt
            url
            staticUrl
            canRollback
            canRedeploy
          }
        }
      `,
      variables: {
        id: params.deploymentId.trim(),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayGetDeploymentData>(response)
    const deployment = data.data?.deployment
    if (!deployment) throw new Error('Railway did not return a deployment')

    const detail: RailwayDeploymentDetail = {
      id: deployment.id,
      status: deployment.status,
      createdAt: deployment.createdAt,
      url: deployment.url ?? null,
      staticUrl: deployment.staticUrl ?? null,
      canRollback: deployment.canRollback ?? false,
      canRedeploy: deployment.canRedeploy ?? false,
    }

    return {
      success: true,
      output: {
        deployment: detail,
      },
    }
  },

  outputs: {
    deployment: {
      type: 'object',
      description: 'Deployment details',
      properties: {
        id: { type: 'string', description: 'Deployment ID' },
        status: { type: 'string', description: 'Deployment status' },
        createdAt: { type: 'string', description: 'Deployment creation timestamp' },
        url: { type: 'string', description: 'Deployment URL', optional: true },
        staticUrl: { type: 'string', description: 'Static deployment URL', optional: true },
        canRollback: {
          type: 'boolean',
          description: 'Whether the deployment can be rolled back to',
        },
        canRedeploy: { type: 'boolean', description: 'Whether the deployment can be redeployed' },
      },
    },
  },
}
