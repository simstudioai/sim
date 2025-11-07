import type {
  LinearCreateWorkflowStateParams,
  LinearCreateWorkflowStateResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateWorkflowStateTool: ToolConfig<
  LinearCreateWorkflowStateParams,
  LinearCreateWorkflowStateResponse
> = {
  id: 'linear_create_workflow_state',
  name: 'Linear Create Workflow State',
  description: 'Create a new workflow state (status) in Linear',
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
      description: 'Team ID to create the state in',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'State name (e.g., "In Review")',
    },
    color: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'State color (hex format)',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'State type: "backlog", "unstarted", "started", "completed", or "canceled"',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State description',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position in the workflow',
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
        teamId: params.teamId,
        name: params.name,
        color: params.color,
        type: params.type,
      }

      if (params.description !== undefined) input.description = params.description
      if (params.position !== undefined) input.position = Number(params.position)

      return {
        query: `
          mutation CreateWorkflowState($input: WorkflowStateCreateInput!) {
            workflowStateCreate(input: $input) {
              success
              workflowState {
                id
                name
                type
                color
                position
                team {
                  id
                  name
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
        error: data.errors[0]?.message || 'Failed to create workflow state',
        output: {},
      }
    }

    const result = data.data.workflowStateCreate
    if (!result.success) {
      return {
        success: false,
        error: 'Workflow state creation was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        state: result.workflowState,
      },
    }
  },

  outputs: {
    state: {
      type: 'object',
      description: 'The created workflow state',
      properties: {
        id: { type: 'string', description: 'State ID' },
        name: { type: 'string', description: 'State name' },
        type: { type: 'string', description: 'State type' },
        color: { type: 'string', description: 'State color' },
        position: { type: 'number', description: 'State position' },
        team: { type: 'object', description: 'Team this state belongs to' },
      },
    },
  },
}
