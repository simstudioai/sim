import type {
  RailwayDeploymentSummary,
  RailwayListDeploymentsParams,
  RailwayListDeploymentsResponse,
  RailwayPageInfo,
} from '@/tools/railway/types'
import {
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayListDeploymentsData {
  deployments?: {
    edges?: Array<{
      node?: RailwayDeploymentSummary
    }>
    pageInfo?: RailwayPageInfo
  }
}

export const railwayListDeploymentsTool: ToolConfig<
  RailwayListDeploymentsParams,
  RailwayListDeploymentsResponse
> = {
  id: 'railway_list_deployments',
  name: 'Railway List Deployments',
  description: 'List deployments for a Railway service in an environment',
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
      description: 'Railway token type: account, workspace, project, or oauth',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway project ID',
    },
    serviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway service ID',
    },
    environmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway environment ID',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of deployments to return',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        query ListDeployments($input: DeploymentListInput!, $first: Int, $after: String) {
          deployments(input: $input, first: $first, after: $after) {
            edges {
              node {
                id
                status
                createdAt
                url
                staticUrl
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      variables: {
        input: {
          projectId: params.projectId.trim(),
          serviceId: params.serviceId.trim(),
          environmentId: params.environmentId.trim(),
        },
        first: params.first ? Number(params.first) : 10,
        after: optionalString(params.after),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayListDeploymentsData>(response)
    const deploymentConnection = data.data?.deployments
    if (!deploymentConnection) throw new Error('Railway did not return deployments')

    const deployments = (deploymentConnection.edges ?? [])
      .map((edge) => edge.node)
      .filter((deployment): deployment is RailwayDeploymentSummary => Boolean(deployment))
      .map((deployment) => ({
        id: deployment.id,
        status: deployment.status,
        createdAt: deployment.createdAt,
        url: deployment.url ?? null,
        staticUrl: deployment.staticUrl ?? null,
      }))

    return {
      success: true,
      output: {
        deployments,
        pageInfo: {
          hasNextPage: deploymentConnection.pageInfo?.hasNextPage ?? false,
          endCursor: deploymentConnection.pageInfo?.endCursor ?? null,
        },
        count: deployments.length,
      },
    }
  },

  outputs: {
    deployments: {
      type: 'array',
      description: 'Service deployments',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Deployment ID' },
          status: { type: 'string', description: 'Deployment status' },
          createdAt: { type: 'string', description: 'Deployment creation timestamp' },
          url: { type: 'string', description: 'Deployment URL', optional: true },
          staticUrl: { type: 'string', description: 'Static deployment URL', optional: true },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of deployments returned',
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        hasNextPage: { type: 'boolean', description: 'Whether more deployments are available' },
        endCursor: { type: 'string', description: 'Cursor for the next page', optional: true },
      },
    },
  },
}
