import type { LinearMergeCustomersParams, LinearMergeCustomersResponse } from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearMergeCustomersTool: ToolConfig<
  LinearMergeCustomersParams,
  LinearMergeCustomersResponse
> = {
  id: 'linear_merge_customers',
  name: 'Linear Merge Customers',
  description: 'Merge two customers in Linear by moving all data from source to target',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    sourceCustomerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source customer ID (will be deleted after merge)',
    },
    targetCustomerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target customer ID (will receive all data)',
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
    body: (params) => ({
      query: `
        mutation CustomerMerge($sourceCustomerId: String!, $targetCustomerId: String!) {
          customerMerge(sourceCustomerId: $sourceCustomerId, targetCustomerId: $targetCustomerId) {
            success
            customer {
              id
              name
              domains
              externalIds
              logoUrl
              approximateNeedCount
              createdAt
              archivedAt
            }
          }
        }
      `,
      variables: {
        sourceCustomerId: params.sourceCustomerId,
        targetCustomerId: params.targetCustomerId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to merge customers',
        output: {},
      }
    }

    const result = data.data.customerMerge
    return {
      success: result.success,
      output: {
        customer: result.customer,
      },
    }
  },

  outputs: {
    customer: {
      type: 'object',
      description: 'The merged target customer',
    },
  },
}
