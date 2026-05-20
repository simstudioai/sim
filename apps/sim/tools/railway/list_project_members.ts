import type {
  RailwayListProjectMembersParams,
  RailwayListProjectMembersResponse,
  RailwayProjectMember,
} from '@/tools/railway/types'
import {
  parseRailwayGraphqlResponse,
  RAILWAY_GRAPHQL_URL,
  railwayHeaders,
} from '@/tools/railway/utils'
import type { ToolConfig } from '@/tools/types'

interface RailwayListProjectMembersData {
  projectMembers?: RailwayProjectMember[]
}

export const railwayListProjectMembersTool: ToolConfig<
  RailwayListProjectMembersParams,
  RailwayListProjectMembersResponse
> = {
  id: 'railway_list_project_members',
  name: 'Railway List Project Members',
  description: 'List members for a Railway project',
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
  },

  request: {
    url: RAILWAY_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => railwayHeaders(params.apiKey, params.tokenType),
    body: (params) => ({
      query: `
        query ProjectMembers($projectId: String!) {
          projectMembers(projectId: $projectId) {
            id
            role
            user {
              id
              name
              email
            }
          }
        }
      `,
      variables: {
        projectId: params.projectId.trim(),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseRailwayGraphqlResponse<RailwayListProjectMembersData>(response)
    const projectMembers = data.data?.projectMembers
    if (!projectMembers) throw new Error('Railway did not return project members')

    const members = projectMembers.map((member) => ({
      id: member.id,
      role: member.role,
      user: member.user
        ? {
            id: member.user.id,
            name: member.user.name ?? null,
            email: member.user.email ?? null,
          }
        : null,
    }))

    return {
      success: true,
      output: {
        members,
        count: members.length,
      },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Project members',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project membership ID' },
          role: { type: 'string', description: 'Project role' },
          user: {
            type: 'object',
            description: 'Railway user',
            properties: {
              id: { type: 'string', description: 'User ID' },
              name: { type: 'string', description: 'User name', optional: true },
              email: { type: 'string', description: 'User email', optional: true },
            },
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of members returned',
    },
  },
}
