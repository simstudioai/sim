import type {
  LinearCreateCustomerTierParams,
  LinearCreateCustomerTierResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateCustomerTierTool: ToolConfig<
  LinearCreateCustomerTierParams,
  LinearCreateCustomerTierResponse
> = {
  id: 'linear_create_customer_tier',
  name: 'Linear Create Customer Tier',
  description: 'Create a new customer tier in Linear',
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
      description: 'Customer tier name',
    },
    color: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tier color (hex code)',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name for the tier',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tier description',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position in tier list',
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
          mutation CustomerTierCreate($input: CustomerTierCreateInput!) {
            customerTierCreate(input: $input) {
              success
              customerTier {
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
        error: data.errors[0]?.message || 'Failed to create customer tier',
        output: {},
      }
    }

    const result = data.data.customerTierCreate
    return {
      success: result.success,
      output: {
        customerTier: result.customerTier,
      },
    }
  },

  outputs: {
    customerTier: {
      type: 'object',
      description: 'The created customer tier',
    },
  },
}
