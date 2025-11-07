import type { ListProjectsParams, ListProjectsResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listProjectsTool: ToolConfig<ListProjectsParams, ListProjectsResponse> = {
  id: 'github_list_projects',
  name: 'GitHub List Projects',
  description:
    'List GitHub Projects V2 for an organization or user. Returns up to 20 projects with their details including ID, title, number, URL, and status.',
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
        query($login: String!) {
          ${ownerType}(login: $login) {
            projectsV2(first: 20) {
              nodes {
                id
                title
                number
                url
                closed
                public
                shortDescription
              }
              totalCount
            }
          }
        }
      `
      return {
        query,
        variables: {
          login: params.owner_login,
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
            projects: [],
            totalCount: 0,
          },
        },
        error: data.errors[0].message,
      }
    }

    const ownerData = data.data?.organization || data.data?.user
    if (!ownerData) {
      return {
        success: false,
        output: {
          content: 'No organization or user found',
          metadata: {
            projects: [],
            totalCount: 0,
          },
        },
        error: 'No organization or user found',
      }
    }

    const projectsData = ownerData.projectsV2
    const projects = projectsData.nodes.map((project: any) => ({
      id: project.id,
      title: project.title,
      number: project.number,
      url: project.url,
      closed: project.closed,
      public: project.public,
      shortDescription: project.shortDescription || '',
    }))

    let content = `Found ${projectsData.totalCount} project(s):\n\n`
    projects.forEach((project: any, index: number) => {
      content += `${index + 1}. ${project.title} (#${project.number})\n`
      content += `   ID: ${project.id}\n`
      content += `   URL: ${project.url}\n`
      content += `   Status: ${project.closed ? 'Closed' : 'Open'}\n`
      content += `   Visibility: ${project.public ? 'Public' : 'Private'}\n`
      if (project.shortDescription) {
        content += `   Description: ${project.shortDescription}\n`
      }
      content += '\n'
    })

    return {
      success: true,
      output: {
        content: content.trim(),
        metadata: {
          projects,
          totalCount: projectsData.totalCount,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable list of projects' },
    metadata: {
      type: 'object',
      description: 'Projects metadata',
      properties: {
        projects: {
          type: 'array',
          description: 'Array of project objects',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Project node ID' },
              title: { type: 'string', description: 'Project title' },
              number: { type: 'number', description: 'Project number' },
              url: { type: 'string', description: 'Project URL' },
              closed: { type: 'boolean', description: 'Whether project is closed' },
              public: { type: 'boolean', description: 'Whether project is public' },
              shortDescription: {
                type: 'string',
                description: 'Project short description',
              },
            },
          },
        },
        totalCount: { type: 'number', description: 'Total number of projects' },
      },
    },
  },
}
