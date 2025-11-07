import type {
  LinearUpdateCustomerTierParams,
  LinearUpdateCustomerTierResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateCustomerTierTool: ToolConfig<
  LinearUpdateCustomerTierParams,
  LinearUpdateCustomerTierResponse
> = {
  id: 'linear_update_customer_tier',
  name: 'Linear Update Customer Tier',
  description: 'Update a customer tier in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    tierId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer tier ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated tier name',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated tier color',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated display name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated description',
    },
    position: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Updated position',
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

      if (params.name !== undefined && params.name !== null && params.name !== '') {
        input.name = params.name
      }
      if (params.color !== undefined && params.color !== null && params.color !== '') {
        input.color = params.color
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
          mutation CustomerTierUpdate($id: String!, $input: CustomerTierUpdateInput!) {
            customerTierUpdate(id: $id, input: $input) {
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
          id: params.tierId,
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
        error: data.errors[0]?.message || 'Failed to update customer tier',
        output: {},
      }
    }

    const result = data.data.customerTierUpdate
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
      description: 'The updated customer tier',
    },
  },
}
