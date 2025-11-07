import type {
  LinearUpdateWorkflowStateParams,
  LinearUpdateWorkflowStateResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateWorkflowStateTool: ToolConfig<
  LinearUpdateWorkflowStateParams,
  LinearUpdateWorkflowStateResponse
> = {
  id: 'linear_update_workflow_state',
  name: 'Linear Update Workflow State',
  description: 'Update an existing workflow state in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    stateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workflow state ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New state name',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New state color (hex format)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New state description',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'New position in workflow',
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
      if (params.color !== undefined) input.color = params.color
      if (params.description !== undefined) input.description = params.description
      if (params.position !== undefined) input.position = Number(params.position)

      return {
        query: `
          mutation UpdateWorkflowState($id: String!, $input: WorkflowStateUpdateInput!) {
            workflowStateUpdate(id: $id, input: $input) {
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
          id: params.stateId,
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
        error: data.errors[0]?.message || 'Failed to update workflow state',
        output: {},
      }
    }

    const result = data.data.workflowStateUpdate
    if (!result.success) {
      return {
        success: false,
        error: 'Workflow state update was not successful',
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
      description: 'The updated workflow state',
      properties: {
        id: { type: 'string', description: 'State ID' },
        name: { type: 'string', description: 'State name' },
        type: { type: 'string', description: 'State type' },
        color: { type: 'string', description: 'State color' },
        position: { type: 'number', description: 'State position' },
      },
    },
  },
}
