import type { ProjectResponse, UpdateProjectParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const updateProjectTool: ToolConfig<UpdateProjectParams, ProjectResponse> = {
  id: 'github_update_project',
  name: 'GitHub Update Project',
  description:
    'Update an existing GitHub Project V2. Can update title, description, visibility (public), or status (closed). Requires the project Node ID.',
  version: '1.0.0',

  params: {
    project_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project Node ID (format: PVT_...)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New project title',
    },
    shortDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New project short description',
    },
    project_public: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set project visibility (true = public, false = private)',
    },
    closed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set project status (true = closed, false = open)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token with project write permissions',
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
      const inputFields: string[] = ['projectId: $projectId']
      const variables: Record<string, any> = {
        projectId: params.project_id,
      }

      if (params.title !== undefined) {
        inputFields.push('title: $title')
        variables.title = params.title
      }
      if (params.shortDescription !== undefined) {
        inputFields.push('shortDescription: $shortDescription')
        variables.shortDescription = params.shortDescription
      }
      if (params.project_public !== undefined) {
        inputFields.push('public: $project_public')
        variables.project_public = params.project_public
      }
      if (params.closed !== undefined) {
        inputFields.push('closed: $closed')
        variables.closed = params.closed
      }

      const variableDefs = ['$projectId: ID!']
      if (params.title !== undefined) variableDefs.push('$title: String')
      if (params.shortDescription !== undefined) variableDefs.push('$shortDescription: String')
      if (params.project_public !== undefined) variableDefs.push('$project_public: Boolean')
      if (params.closed !== undefined) variableDefs.push('$closed: Boolean')

      const query = `
        mutation(${variableDefs.join(', ')}) {
          updateProjectV2(input: {
            ${inputFields.join('\n            ')}
          }) {
            projectV2 {
              id
              title
              number
              url
              closed
              public
              shortDescription
            }
          }
        }
      `
      return {
        query,
        variables,
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

    const project = data.data?.updateProjectV2?.projectV2
    if (!project) {
      return {
        success: false,
        output: {
          content: 'Failed to update project',
          metadata: {
            id: '',
            title: '',
            url: '',
          },
        },
        error: 'Failed to update project',
      }
    }

    let content = `Project updated successfully!\n`
    content += `Title: ${project.title}\n`
    content += `ID: ${project.id}\n`
    content += `Number: ${project.number}\n`
    content += `URL: ${project.url}\n`
    content += `Status: ${project.closed ? 'Closed' : 'Open'}\n`
    content += `Visibility: ${project.public ? 'Public' : 'Private'}\n`
    if (project.shortDescription) {
      content += `Description: ${project.shortDescription}`
    }

    return {
      success: true,
      output: {
        content: content.trim(),
        metadata: {
          id: project.id,
          title: project.title,
          number: project.number,
          url: project.url,
          closed: project.closed,
          public: project.public,
          shortDescription: project.shortDescription || '',
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable confirmation message' },
    metadata: {
      type: 'object',
      description: 'Updated project metadata',
      properties: {
        id: { type: 'string', description: 'Project node ID' },
        title: { type: 'string', description: 'Project title' },
        number: { type: 'number', description: 'Project number', optional: true },
        url: { type: 'string', description: 'Project URL' },
        closed: { type: 'boolean', description: 'Whether project is closed', optional: true },
        public: { type: 'boolean', description: 'Whether project is public', optional: true },
        shortDescription: {
          type: 'string',
          description: 'Project short description',
          optional: true,
        },
      },
    },
  },
}
