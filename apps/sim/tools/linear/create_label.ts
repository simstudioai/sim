import type { LinearCreateLabelParams, LinearCreateLabelResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateLabelTool: ToolConfig<LinearCreateLabelParams, LinearCreateLabelResponse> =
  {
    id: 'linear_create_label',
    name: 'Linear Create Label',
    description: 'Create a new label in Linear',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'linear',
    },

    params: {
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Label name',
      },
      color: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Label color (hex format, e.g., "#ff0000")',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Label description',
      },
      teamId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Team ID (if omitted, creates workspace label)',
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
          name: params.name,
        }

        if (params.color !== undefined && params.color !== null && params.color !== '')
          input.color = params.color
        if (
          params.description !== undefined &&
          params.description !== null &&
          params.description !== ''
        )
          input.description = params.description
        if (params.teamId !== undefined && params.teamId !== null && params.teamId !== '')
          input.teamId = params.teamId

        return {
          query: `
          mutation CreateLabel($input: IssueLabelCreateInput!) {
            issueLabelCreate(input: $input) {
              success
              issueLabel {
                id
                name
                color
                description
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
          error: data.errors[0]?.message || 'Failed to create label',
          output: {},
        }
      }

      const result = data.data.issueLabelCreate
      if (!result.success) {
        return {
          success: false,
          error: 'Label creation was not successful',
          output: {},
        }
      }

      return {
        success: true,
        output: {
          label: result.issueLabel,
        },
      }
    },

    outputs: {
      label: {
        type: 'object',
        description: 'The created label',
        properties: {
          id: { type: 'string', description: 'Label ID' },
          name: { type: 'string', description: 'Label name' },
          color: { type: 'string', description: 'Label color' },
          description: { type: 'string', description: 'Label description' },
          team: { type: 'object', description: 'Team this label belongs to' },
        },
      },
    },
  }
