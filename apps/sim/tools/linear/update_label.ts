import type { LinearUpdateLabelParams, LinearUpdateLabelResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateLabelTool: ToolConfig<LinearUpdateLabelParams, LinearUpdateLabelResponse> =
  {
    id: 'linear_update_label',
    name: 'Linear Update Label',
    description: 'Update an existing label in Linear',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'linear',
    },

    params: {
      labelId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Label ID to update',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New label name',
      },
      color: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New label color (hex format)',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New label description',
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

        if (params.name !== undefined && params.name !== null && params.name !== '')
          input.name = params.name
        if (params.color !== undefined && params.color !== null && params.color !== '')
          input.color = params.color
        if (
          params.description !== undefined &&
          params.description !== null &&
          params.description !== ''
        )
          input.description = params.description

        return {
          query: `
          mutation UpdateLabel($id: String!, $input: IssueLabelUpdateInput!) {
            issueLabelUpdate(id: $id, input: $input) {
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
            id: params.labelId,
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
          error: data.errors[0]?.message || 'Failed to update label',
          output: {},
        }
      }

      const result = data.data.issueLabelUpdate
      if (!result.success) {
        return {
          success: false,
          error: 'Label update was not successful',
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
        description: 'The updated label',
        properties: {
          id: { type: 'string', description: 'Label ID' },
          name: { type: 'string', description: 'Label name' },
          color: { type: 'string', description: 'Label color' },
          description: { type: 'string', description: 'Label description' },
        },
      },
    },
  }
