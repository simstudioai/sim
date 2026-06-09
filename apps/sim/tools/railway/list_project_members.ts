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
      description:
        'Railway token type. Use "account" for account, workspace, or OAuth tokens, or "project" for project tokens.',
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
            name
            email
            avatar
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
      name: member.name ?? null,
      email: member.email ?? null,
      avatar: member.avatar ?? null,
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
          id: { type: 'string', description: 'Member user ID' },
          role: { type: 'string', description: 'Project role' },
          name: { type: 'string', description: 'Member name', optional: true },
          email: { type: 'string', description: 'Member email', optional: true },
          avatar: { type: 'string', description: 'Member avatar URL', optional: true },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of members returned',
    },
  },
}
