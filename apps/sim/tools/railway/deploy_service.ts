import type {
  RailwayDeployServiceParams,
  RailwayDeployServiceResponse,
} from '@/tools/railway/types'
import {
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayDeployServiceData {
  serviceInstanceDeployV2?: string
}

export const railwayDeployServiceTool: ToolConfig<
  RailwayDeployServiceParams,
  RailwayDeployServiceResponse
> = {
  id: 'railway_deploy_service',
  name: 'Railway Deploy Service',
  description: 'Trigger a deployment for a Railway service in an environment',
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
    commitSha: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific Git commit SHA to deploy',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => {
      const commitSha = optionalString(params.commitSha)

      if (commitSha) {
        return {
          query: `
            mutation DeployService($serviceId: String!, $environmentId: String!, $commitSha: String!) {
              serviceInstanceDeployV2(
                serviceId: $serviceId
                environmentId: $environmentId
                commitSha: $commitSha
              )
            }
          `,
          variables: {
            serviceId: params.serviceId.trim(),
            environmentId: params.environmentId.trim(),
            commitSha,
          },
        }
      }

      return {
        query: `
          mutation DeployService($serviceId: String!, $environmentId: String!) {
            serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
          }
        `,
        variables: {
          serviceId: params.serviceId.trim(),
          environmentId: params.environmentId.trim(),
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayDeployServiceData>(response)
    const deploymentId = data.data?.serviceInstanceDeployV2
    if (!deploymentId) throw new Error('Railway did not return a deployment ID')

    return {
      success: true,
      output: {
        deploymentId,
      },
    }
  },

  outputs: {
    deploymentId: {
      type: 'string',
      description: 'Created deployment ID',
    },
  },
}
