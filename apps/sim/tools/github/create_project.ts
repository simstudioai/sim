import type { CreateProjectParams, ProjectResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const createProjectTool: ToolConfig<CreateProjectParams, ProjectResponse> = {
  id: 'github_create_project',
  name: 'GitHub Create Project',
  description:
    'Create a new GitHub Project V2. Requires the owner Node ID (not login name). Returns the created project with ID, title, and URL.',
  version: '1.0.0',

  params: {
    owner_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Owner Node ID (format: PVT_... or MDQ6...). Use GitHub GraphQL API to get this ID from organization or user login.',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project title',
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
      const query = `
        mutation($ownerId: ID!, $title: String!) {
          createProjectV2(input: {
            ownerId: $ownerId
            title: $title
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
        variables: {
          ownerId: params.owner_id,
          title: params.title,
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

    const project = data.data?.createProjectV2?.projectV2
    if (!project) {
      return {
        success: false,
        output: {
          content: 'Failed to create project',
          metadata: {
            id: '',
            title: '',
            url: '',
          },
        },
        error: 'Failed to create project',
      }
    }

    let content = `Project created successfully!\n`
    content += `Title: ${project.title}\n`
    content += `ID: ${project.id}\n`
    content += `Number: ${project.number}\n`
    content += `URL: ${project.url}\n`
    content += `Status: ${project.closed ? 'Closed' : 'Open'}\n`
    content += `Visibility: ${project.public ? 'Public' : 'Private'}`

    return {
      success: true,
      output: {
        content,
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
      description: 'Created project metadata',
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
