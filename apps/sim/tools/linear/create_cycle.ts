import type { LinearCreateCycleParams, LinearCreateCycleResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateCycleTool: ToolConfig<LinearCreateCycleParams, LinearCreateCycleResponse> =
  {
    id: 'linear_create_cycle',
    name: 'Linear Create Cycle',
    description: 'Create a new cycle (sprint/iteration) in Linear',
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
        description: 'Team ID to create the cycle in',
      },
      startsAt: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Cycle start date (ISO format)',
      },
      endsAt: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Cycle end date (ISO format)',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Cycle name (optional, will be auto-generated if not provided)',
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
          startsAt: params.startsAt,
          endsAt: params.endsAt,
        }

        if (params.name !== undefined && params.name !== null && params.name !== '')
          input.name = params.name

        return {
          query: `
          mutation CreateCycle($input: CycleCreateInput!) {
            cycleCreate(input: $input) {
              success
              cycle {
                id
                number
                name
                startsAt
                endsAt
                progress
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
          error: data.errors[0]?.message || 'Failed to create cycle',
          output: {},
        }
      }

      const result = data.data.cycleCreate
      if (!result.success) {
        return {
          success: false,
          error: 'Cycle creation was not successful',
          output: {},
        }
      }

      return {
        success: true,
        output: {
          cycle: result.cycle,
        },
      }
    },

    outputs: {
      cycle: {
        type: 'object',
        description: 'The created cycle',
        properties: {
          id: { type: 'string', description: 'Cycle ID' },
          number: { type: 'number', description: 'Cycle number' },
          name: { type: 'string', description: 'Cycle name' },
          startsAt: { type: 'string', description: 'Start date' },
          endsAt: { type: 'string', description: 'End date' },
          team: { type: 'object', description: 'Team this cycle belongs to' },
        },
      },
    },
  }
