import type { DeleteProjectParams, ProjectResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const deleteProjectTool: ToolConfig<DeleteProjectParams, ProjectResponse> = {
  id: 'github_delete_project',
  name: 'GitHub Delete Project',
  description:
    'Delete a GitHub Project V2. This action is permanent and cannot be undone. Requires the project Node ID.',
  version: '1.0.0',

  params: {
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project Node ID (format: PVT_...)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token with project admin permissions',
    },
  },

  request: {
    url: 'https://api.github.com/graphql',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const query = `
        mutation($projectId: ID!) {
          deleteProjectV2(input: {
            projectId: $projectId
          }) {
            projectV2 {
              id
              title
              number
              url
            }
          }
        }
      `
      return {
        query,
        variables: {
          projectId: params.project_id,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        output: {
          content: `GraphQL Error: ${data.errors[0].message}`,
          metadata: {
            id: '',
            title: '',
            url: '',
          },
        },
        error: data.errors[0].message,
      }
    }

    // Extract project data
    const project = data.data?.deleteProjectV2?.projectV2
    if (!project) {
      return {
        success: false,
        output: {
          content: 'Failed to delete project',
          metadata: {
            id: '',
            title: '',
            url: '',
          },
        },
        error: 'Failed to delete project',
      }
    }

    // Create human-readable content
    let content = `Project deleted successfully!\n`
    content += `Title: ${project.title}\n`
    content += `ID: ${project.id}\n`
    if (project.number) {
      content += `Number: ${project.number}\n`
    }
    content += `URL: ${project.url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: project.id,
          title: project.title,
          number: project.number,
          url: project.url,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable confirmation message' },
    metadata: {
      type: 'object',
      description: 'Deleted project metadata',
      properties: {
        id: { type: 'string', description: 'Project node ID' },
        title: { type: 'string', description: 'Project title' },
        number: { type: 'number', description: 'Project number', optional: true },
        url: { type: 'string', description: 'Project URL' },
      },
    },
  },
}
