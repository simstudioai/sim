import type {
  LinearListProjectLabelsParams,
  LinearListProjectLabelsResponse,
} from '@/tools/linear/types'
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
      // If projectId is provided, query the specific project's labels
      if (params.projectId?.trim()) {
        return {
          query: `
            query ProjectWithLabels($id: String!) {
              project(id: $id) {
                id
                name
                labels {
                  nodes {
                    id
                    name
                    description
                    color
                    isGroup
                    createdAt
                    archivedAt
                  }
                }
              }
            }
          `,
          variables: {
            id: params.projectId.trim(),
          },
        }
      }

      // Otherwise, list all project labels
      return {
        query: `
          query ProjectLabels {
            projectLabels {
              nodes {
                id
                name
                description
                color
                isGroup
                createdAt
                archivedAt
              }
            }
          }
        `,
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

    // Handle project-specific query response
    if (data.data.project) {
      return {
        success: true,
        output: {
          projectLabels: data.data.project.labels.nodes,
        },
      }
    }

    // Handle global projectLabels query response
    return {
      success: true,
      output: {
        projectLabels: data.data.projectLabels.nodes,
      },
    }
  },

  outputs: {
    projectLabels: {
      type: 'array',
      description: 'List of project labels',
    },
  },
}
