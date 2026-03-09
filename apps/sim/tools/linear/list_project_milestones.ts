import type {
  LinearListProjectMilestonesParams,
  LinearListProjectMilestonesResponse,
} from '@/tools/linear/types'
import { PAGE_INFO_OUTPUT, PROJECT_MILESTONE_OUTPUT_PROPERTIES } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListProjectMilestonesTool: ToolConfig<
  LinearListProjectMilestonesParams,
  LinearListProjectMilestonesResponse
> = {
  id: 'linear_list_project_milestones',
  name: 'Linear List Project Milestones',
  description: 'List all milestones for a project in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID to list milestones for',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of milestones to return (default: 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for pagination',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => ({
      query: `
        query Project($id: String!, $first: Int, $after: String) {
          project(id: $id) {
            projectMilestones(first: $first, after: $after) {
              nodes {
                id
                name
                description
                targetDate
                progress
                sortOrder
                status
                createdAt
                archivedAt
                project {
                  id
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      variables: {
        id: params.projectId,
        first: params.first ? Number(params.first) : 50,
        after: params.after,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list project milestones',
        output: {},
      }
    }

    const result = data.data.project?.projectMilestones
    const milestones = (result?.nodes || []).map((node: Record<string, unknown>) => ({
      ...node,
      projectId: (node.project as Record<string, string>)?.id ?? null,
      project: undefined,
    }))
    return {
      success: true,
      output: {
        projectMilestones: milestones,
        pageInfo: {
          hasNextPage: result?.pageInfo?.hasNextPage ?? false,
          endCursor: result?.pageInfo?.endCursor,
        },
      },
    }
  },

  outputs: {
    projectMilestones: {
      type: 'array',
      description: 'List of project milestones',
      items: {
        type: 'object',
        properties: PROJECT_MILESTONE_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: PAGE_INFO_OUTPUT,
  },
}
