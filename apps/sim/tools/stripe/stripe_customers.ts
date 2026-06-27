import type { ToolConfig } from '@/tools/types'
import { transformStripeResponse } from './types'

export const stripeCustomersTool: ToolConfig = {
  id: 'stripe_customers',
  name: 'Stripe Customers',
  description:
    'Manage Stripe customers, customer sessions, and contact information. Create, retrieve, update, list, and delete customers across your Stripe account.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (sk_live_* or sk_test_*)',
    },
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer operation to perform',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer ID (required for retrieve, update, delete operations)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer email address',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional customer description',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer full name',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer phone number',
    },
    preferredLocales: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer preferred locales (comma-separated)',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom key-value metadata for the customer',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results per page (1-100, default: 10)',
    },
    startingAfter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Customer ID to start pagination after',
    },
    endingBefore: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Customer ID to end pagination before',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expand nested resources (comma-separated, e.g., "default_source,subscriptions")',
    },
  },
  outputs: {
    customer: {
      type: 'object',
      description: 'The customer object or list of customers',
      properties: {
        id: { type: 'string', description: 'Customer ID' },
        object: { type: 'string', description: 'Object type' },
        email: { type: 'string', description: 'Customer email' },
        name: { type: 'string', description: 'Customer name' },
        phone: { type: 'string', description: 'Customer phone' },
        description: { type: 'string', description: 'Customer description' },
        created: { type: 'number', description: 'Unix timestamp of creation' },
      },
    },
    items: {
      type: 'array',
      description: 'List of customer objects (when listing)',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results are available (when listing)',
      optional: true,
    },
    error: {
      type: 'string',
      description: 'Error message if request failed',
      optional: true,
    },
  },
  request: {
    url: (params) => {
      const operation = params.operation as string
      const baseUrl = 'https://api.stripe.com/v1'

      switch (operation) {
        case 'list_customers':
          return `${baseUrl}/customers`
        case 'create_customer':
          return `${baseUrl}/customers`
        case 'retrieve_customer':
          return `${baseUrl}/customers/${params.customerId}`
        case 'update_customer':
          return `${baseUrl}/customers/${params.customerId}`
        case 'delete_customer':
          return `${baseUrl}/customers/${params.customerId}`
        case 'list_contacts':
          return `${baseUrl}/customers/${params.customerId}/contacts`
        case 'create_customer_session':
          return `${baseUrl}/customer_sessions`
        case 'retrieve_customer_session':
          return `${baseUrl}/customer_sessions/${params.customerId}`
        default:
          throw new Error(`Unknown operation: ${operation}`)
      }
    },
    method: (params) => {
      const operation = params.operation as string
      switch (operation) {
        case 'list_customers':
        case 'list_contacts':
        case 'retrieve_customer':
        case 'retrieve_customer_session':
          return 'GET'
        case 'create_customer':
        case 'create_customer_session':
          return 'POST'
        case 'update_customer':
          return 'POST'
        case 'delete_customer':
          return 'DELETE'
        default:
          return 'GET'
      }
    },
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    body: (params) => {
      const operation = params.operation as string
      const formData = new URLSearchParams()

      if (operation === 'create_customer') {
        if (params.email) formData.append('email', params.email as string)
        if (params.name) formData.append('name', params.name as string)
        if (params.description) formData.append('description', params.description as string)
        if (params.phone) formData.append('phone', params.phone as string)
        if (params.preferredLocales)
          formData.append('preferred_locales', params.preferredLocales as string)
        if (params.metadata) {
          const metadata = params.metadata as Record<string, string>
          Object.entries(metadata).forEach(([key, value]) => {
            formData.append(`metadata[${key}]`, value)
          })
        }
      }

      if (operation === 'update_customer') {
        if (params.email) formData.append('email', params.email as string)
        if (params.name) formData.append('name', params.name as string)
        if (params.description) formData.append('description', params.description as string)
        if (params.phone) formData.append('phone', params.phone as string)
        if (params.metadata) {
          const metadata = params.metadata as Record<string, string>
          Object.entries(metadata).forEach(([key, value]) => {
            formData.append(`metadata[${key}]`, value)
          })
        }
      }

      if (operation === 'list_customers' || operation === 'list_contacts') {
        if (params.limit) formData.append('limit', String(params.limit))
        if (params.startingAfter) formData.append('starting_after', params.startingAfter as string)
        if (params.endingBefore) formData.append('ending_before', params.endingBefore as string)
      }

      if (params.expand) {
        formData.append('expand[]', params.expand as string)
      }

      return formData.toString()
    },
  },
  transformResponse: transformStripeResponse,
}
