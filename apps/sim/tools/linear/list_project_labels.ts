import type {
  LinearListProjectLabelsParams,
  LinearListProjectLabelsResponse,
} from '@/tools/linear/types'
import { PAGE_INFO_OUTPUT, PROJECT_LABEL_OUTPUT_PROPERTIES } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearListProjectLabelsTool: ToolConfig<
  LinearListProjectLabelsParams,
  LinearListProjectLabelsResponse
> = {
  id: 'linear_list_project_labels',
  name: 'Linear List Project Labels',
  description: 'List all project labels in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional project ID to filter labels for a specific project',
    },
    first: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of labels to return (default: 50)',
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
    body: (params) => {
      if (params.projectId?.trim()) {
        return {
          query: `
            query ProjectWithLabels($id: String!, $first: Int, $after: String) {
              project(id: $id) {
                id
                name
                labels(first: $first, after: $after) {
                  nodes {
                    id
                    name
                    description
                    color
                    isGroup
                    createdAt
                    updatedAt
                    archivedAt
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
            id: params.projectId.trim(),
            first: params.first ? Number(params.first) : 50,
            after: params.after,
          },
        }
      }

      return {
        query: `
          query ProjectLabels($first: Int, $after: String) {
            projectLabels(first: $first, after: $after) {
              nodes {
                id
                name
                description
                color
                isGroup
                createdAt
                updatedAt
                archivedAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        variables: {
          first: params.first ? Number(params.first) : 50,
          after: params.after,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to list project labels',
        output: {},
      }
    }

    if (data.data.project) {
      const result = data.data.project.labels
      return {
        success: true,
        output: {
          projectLabels: result.nodes,
          pageInfo: {
            hasNextPage: result.pageInfo.hasNextPage,
            endCursor: result.pageInfo.endCursor,
          },
        },
      }
    }

    const result = data.data.projectLabels
    return {
      success: true,
      output: {
        projectLabels: result.nodes,
        pageInfo: {
          hasNextPage: result.pageInfo.hasNextPage,
          endCursor: result.pageInfo.endCursor,
        },
      },
    }
  },

  outputs: {
    projectLabels: {
      type: 'array',
      description: 'List of project labels',
      items: {
        type: 'object',
        properties: PROJECT_LABEL_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: PAGE_INFO_OUTPUT,
  },
}
