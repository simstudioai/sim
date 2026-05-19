import type {
  RailwayCreatedResource,
  RailwayCreateEnvironmentParams,
  RailwayCreateEnvironmentResponse,
} from '@/tools/railway/types'
import {
  compactVariables,
  optionalString,
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayCreateEnvironmentData {
  environmentCreate?: RailwayCreatedResource
}

export const railwayCreateEnvironmentTool: ToolConfig<
  RailwayCreateEnvironmentParams,
  RailwayCreateEnvironmentResponse
> = {
  id: 'railway_create_environment',
  name: 'Railway Create Environment',
  description: 'Create a Railway project environment',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Environment name',
    },
    sourceEnvironmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Environment ID to clone from',
    },
    ephemeral: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the environment is ephemeral',
    },
    skipInitialDeploys: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to skip initial deploys for the environment',
    },
    stageInitialChanges: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to stage initial changes instead of applying them immediately',
    },
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        mutation CreateEnvironment($input: EnvironmentCreateInput!) {
          environmentCreate(input: $input) {
            id
            name
          }
        }
      `,
      variables: {
        input: compactVariables({
          projectId: params.projectId.trim(),
          name: params.name.trim(),
          sourceEnvironmentId: optionalString(params.sourceEnvironmentId),
          ephemeral: params.ephemeral,
          skipInitialDeploys: params.skipInitialDeploys,
          stageInitialChanges: params.stageInitialChanges,
        }),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayCreateEnvironmentData>(response)
    const environment = data.data?.environmentCreate
    if (!environment) throw new Error('Railway did not return a created environment')

    return {
      success: true,
      output: {
        environment: {
          id: environment.id,
          name: environment.name,
        },
      },
    }
  },

  outputs: {
    environment: {
      type: 'object',
      description: 'Created environment',
      properties: {
        id: { type: 'string', description: 'Environment ID' },
        name: { type: 'string', description: 'Environment name' },
      },
    },
  },
}
