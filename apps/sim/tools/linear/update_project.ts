import type { LinearUpdateProjectParams, LinearUpdateProjectResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateProjectTool: ToolConfig<
  LinearUpdateProjectParams,
  LinearUpdateProjectResponse
> = {
  id: 'linear_update_project',
  name: 'Linear Update Project',
  description: 'Update an existing project in Linear',
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
      description: 'Project ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New project name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New project description',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project state (planned, started, completed, canceled)',
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
      const input: Record<string, any> = {}

      if (params.name !== undefined) input.name = params.name
      if (params.description !== undefined) input.description = params.description
      if (params.state !== undefined) input.state = params.state
      if (params.leadId !== undefined) input.leadId = params.leadId
      if (params.startDate !== undefined) input.startDate = params.startDate
      if (params.targetDate !== undefined) input.targetDate = params.targetDate
      if (params.priority !== undefined) input.priority = Number(params.priority)

      return {
        query: `
          mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
            projectUpdate(id: $id, input: $input) {
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
          id: params.projectId,
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
        error: data.errors[0]?.message || 'Failed to update project',
        output: {},
      }
    }

    const result = data.data.projectUpdate
    if (!result.success) {
      return {
        success: false,
        error: 'Project update was not successful',
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
      description: 'The updated project',
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
