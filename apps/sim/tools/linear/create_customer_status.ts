import type {
  LinearCreateCustomerStatusParams,
  LinearCreateCustomerStatusResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateCustomerStatusTool: ToolConfig<
  LinearCreateCustomerStatusParams,
  LinearCreateCustomerStatusResponse
> = {
  id: 'linear_create_customer_status',
  name: 'Linear Create Customer Status',
  description: 'Create a new customer status in Linear',
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
      description: 'Customer status name',
    },
    color: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Status color (hex code)',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name for the status',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status description',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position in status list',
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
        color: params.color,
      }

      if (
        params.displayName !== undefined &&
        params.displayName !== null &&
        params.displayName !== ''
      ) {
        input.displayName = params.displayName
      }
      if (
        params.description !== undefined &&
        params.description !== null &&
        params.description !== ''
      ) {
        input.description = params.description
      }
      if (params.position !== undefined && params.position !== null) {
        input.position = params.position
      }

      return {
        query: `
          mutation CustomerStatusCreate($input: CustomerStatusCreateInput!) {
            customerStatusCreate(input: $input) {
              success
              status {
                id
                name
                displayName
                description
                color
                position
                createdAt
                archivedAt
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
        error: data.errors[0]?.message || 'Failed to create customer status',
        output: {},
      }
    }

    const result = data.data.customerStatusCreate
    return {
      success: result.success,
      output: {
        customerStatus: result.status,
      },
    }
  },

  outputs: {
    customerStatus: {
      type: 'object',
      description: 'The created customer status',
    },
  },
}
