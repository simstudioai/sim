import type { LinearCreateProjectParams, LinearCreateProjectResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateProjectTool: ToolConfig<
  LinearCreateProjectParams,
  LinearCreateProjectResponse
> = {
  id: 'linear_create_project',
  name: 'Linear Create Project',
  description: 'Create a new project in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Team ID to create the project in',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project description',
    },
    leadId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID of the project lead',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project start date (ISO format)',
    },
    targetDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project target date (ISO format)',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project priority (0-4)',
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
        teamIds: [params.teamId],
        name: params.name,
      }

      if (params.description !== undefined) input.description = params.description
      if (params.leadId !== undefined) input.leadId = params.leadId
      if (params.startDate !== undefined) input.startDate = params.startDate
      if (params.targetDate !== undefined) input.targetDate = params.targetDate
      if (params.priority !== undefined) input.priority = Number(params.priority)

      return {
        query: `
          mutation CreateProject($input: ProjectCreateInput!) {
            projectCreate(input: $input) {
              success
              project {
                id
                name
                description
                state
                priority
                startDate
                targetDate
                url
                lead {
                  id
                  name
                }
                teams {
                  nodes {
                    id
                    name
                  }
                }
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
        error: data.errors[0]?.message || 'Failed to create project',
        output: {},
      }
    }

    const result = data.data.projectCreate
    if (!result.success) {
      return {
        success: false,
        error: 'Project creation was not successful',
        output: {},
      }
    }

    const project = result.project
    return {
      success: true,
      output: {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          state: project.state,
          priority: project.priority,
          startDate: project.startDate,
          targetDate: project.targetDate,
          url: project.url,
          lead: project.lead,
          teams: project.teams?.nodes || [],
        },
      },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'The created project',
      properties: {
        id: { type: 'string', description: 'Project ID' },
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string', description: 'Project description' },
        state: { type: 'string', description: 'Project state' },
        priority: { type: 'number', description: 'Project priority' },
        lead: { type: 'object', description: 'Project lead' },
        teams: { type: 'array', description: 'Associated teams' },
      },
    },
  },
}
