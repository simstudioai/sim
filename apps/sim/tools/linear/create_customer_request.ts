import type {
  LinearCreateCustomerRequestParams,
  LinearCreateCustomerRequestResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateCustomerRequestTool: ToolConfig<
  LinearCreateCustomerRequestParams,
  LinearCreateCustomerRequestResponse
> = {
  id: 'linear_create_customer_request',
  name: 'Linear Create Customer Request',
  description:
    'Create a customer request (need) in Linear. Assign to customer, set urgency (priority: 0 = Not important, 1 = Important), and optionally link to an issue.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID to assign this request to',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the customer request',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Urgency level: 0 = Not important, 1 = Important (default: 0)',
    },
    issueId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Issue ID to link this request to',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project ID to link this request to',
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
        customerId: params.customerId,
        priority: params.priority !== undefined && params.priority !== null ? params.priority : 0,
      }

      // Optional fields with proper validation
      if (params.body !== undefined && params.body !== null && params.body !== '') {
        input.body = params.body
      }
      if (params.issueId !== undefined && params.issueId !== null && params.issueId !== '') {
        input.issueId = params.issueId
      }
      if (params.projectId !== undefined && params.projectId !== null && params.projectId !== '') {
        input.projectId = params.projectId
      }

      return {
        query: `
          mutation CustomerNeedCreate($input: CustomerNeedCreateInput!) {
            customerNeedCreate(input: $input) {
              success
              need {
                id
                body
                priority
                createdAt
                updatedAt
                archivedAt
                customer {
                  id
                  name
                }
                issue {
                  id
                  title
                }
                project {
                  id
                  name
                }
                creator {
                  id
                  name
                }
                url
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
        error: data.errors[0]?.message || 'Failed to create customer request',
        output: {},
      }
    }

    const result = data.data.customerNeedCreate
    return {
      success: result.success,
      output: {
        customerNeed: result.need,
      },
    }
  },

  outputs: {
    customerNeed: {
      type: 'object',
      description: 'The created customer request',
      properties: {
        id: { type: 'string', description: 'Customer request ID' },
        body: { type: 'string', description: 'Request description' },
        priority: {
          type: 'number',
          description: 'Urgency level (0 = Not important, 1 = Important)',
        },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
        archivedAt: { type: 'string', description: 'Archive timestamp (null if not archived)' },
        customer: { type: 'object', description: 'Assigned customer' },
        issue: { type: 'object', description: 'Linked issue (null if not linked)' },
        project: { type: 'object', description: 'Linked project (null if not linked)' },
        creator: { type: 'object', description: 'User who created the request' },
        url: { type: 'string', description: 'URL to the customer request' },
      },
    },
  },
}
