import type {
  RailwayCreatedResource,
  RailwayCreateServiceParams,
  RailwayCreateServiceResponse,
} from '@/tools/railway/types'
import {
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayCreateServiceData {
  serviceCreate?: RailwayCreatedResource
}

export const railwayCreateServiceTool: ToolConfig<
  RailwayCreateServiceParams,
  RailwayCreateServiceResponse
> = {
  id: 'railway_create_service',
  name: 'Railway Create Service',
  description: 'Create a Railway service from a GitHub repo or Docker image',
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
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Railway project ID',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service name',
    },
    repo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GitHub repository in owner/name format to deploy from',
    },
    image: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Docker image to deploy, for example redis:7-alpine',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Git branch to deploy when using a repository source',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => {
      const repo = optionalString(params.repo)
      const image = optionalString(params.image)
      const branch = optionalString(params.branch)

      const source = repo ? { repo } : image ? { image } : undefined

      return {
        query: `
          mutation CreateService($input: ServiceCreateInput!) {
            serviceCreate(input: $input) {
              id
              name
            }
          }
        `,
        variables: {
          input: {
            projectId: params.projectId.trim(),
            name: params.name.trim(),
            ...(source ? { source } : {}),
            ...(branch ? { branch } : {}),
          },
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayCreateServiceData>(response)
    const service = data.data?.serviceCreate
    if (!service) throw new Error('Railway did not return a created service')

    return {
      success: true,
      output: {
        service: {
          id: service.id,
          name: service.name,
        },
      },
    }
  },

  outputs: {
    service: {
      type: 'object',
      description: 'Created service',
      properties: {
        id: { type: 'string', description: 'Service ID' },
        name: { type: 'string', description: 'Service name' },
      },
    },
  },
}
