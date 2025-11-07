import type {
  LinearCreateProjectLinkParams,
  LinearCreateProjectLinkResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateProjectLinkTool: ToolConfig<
  LinearCreateProjectLinkParams,
  LinearCreateProjectLinkResponse
> = {
  id: 'linear_create_project_link',
  name: 'Linear Create Project Link',
  description: 'Add an external link to a project in Linear',
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
      description: 'Project ID to add link to',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the external link',
    },
    label: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Link label/title',
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
      const input: Record<string, any> = {
        projectId: params.projectId,
        url: params.url,
      }

      if (params.label !== undefined && params.label !== null && params.label !== '')
        input.label = params.label

      return {
        query: `
          mutation CreateProjectLink($input: ProjectLinkCreateInput!) {
            projectLinkCreate(input: $input) {
              success
              projectLink {
                id
                url
                label
                createdAt
              }
            }
          }
        `,
        variables: {
          input,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to create project link',
        output: {},
      }
    }

    const result = data.data.projectLinkCreate
    if (!result.success) {
      return {
        success: false,
        error: 'Project link creation was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        link: result.projectLink,
      },
    }
  },

  outputs: {
    link: {
      type: 'object',
      description: 'The created project link',
      properties: {
        id: { type: 'string', description: 'Link ID' },
        url: { type: 'string', description: 'Link URL' },
        label: { type: 'string', description: 'Link label' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
      },
    },
  },
}
