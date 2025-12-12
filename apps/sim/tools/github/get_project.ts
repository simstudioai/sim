import type { GetProjectParams, ProjectResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getProjectTool: ToolConfig<GetProjectParams, ProjectResponse> = {
  id: 'github_get_project',
  name: 'GitHub Get Project',
  description:
    'Get detailed information about a specific GitHub Project V2 by its number. Returns project details including ID, title, description, URL, and status.',
  version: '1.0.0',

  params: {
    owner_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Owner type: "org" for organization or "user" for user',
    },
    owner_login: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization or user login name',
    },
    project_number: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project number',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token with project read permissions',
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
      const ownerType = params.owner_type === 'org' ? 'organization' : 'user'
      const query = `
        query($login: String!, $number: Int!) {
          ${ownerType}(login: $login) {
            projectV2(number: $number) {
              id
              title
              number
              url
              closed
              public
              shortDescription
              readme
              createdAt
              updatedAt
            }
          }
        }
      `
      return {
        query,
        variables: {
          login: params.owner_login,
          number: params.project_number,
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

    const ownerData = data.data?.organization || data.data?.user
    if (!ownerData || !ownerData.projectV2) {
      return {
        success: false,
        output: {
          content: 'Project not found',
          metadata: {
            id: '',
            title: '',
            url: '',
          },
        },
        error: 'Project not found',
      }
    }

    const project = ownerData.projectV2

    let content = `Project: ${project.title} (#${project.number})\n`
    content += `ID: ${project.id}\n`
    content += `URL: ${project.url}\n`
    content += `Status: ${project.closed ? 'Closed' : 'Open'}\n`
    content += `Visibility: ${project.public ? 'Public' : 'Private'}\n`
    if (project.shortDescription) {
      content += `Description: ${project.shortDescription}\n`
    }
    if (project.createdAt) {
      content += `Created: ${project.createdAt}\n`
    }
    if (project.updatedAt) {
      content += `Updated: ${project.updatedAt}\n`
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
    content: { type: 'string', description: 'Human-readable project details' },
    metadata: {
      type: 'object',
      description: 'Project metadata',
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
