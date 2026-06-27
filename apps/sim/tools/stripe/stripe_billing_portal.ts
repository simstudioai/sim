import type { ToolConfig } from '@/tools/types'

export const stripeBillingPortalTool: ToolConfig = {
  id: 'stripe_billing_portal',
  name: 'Stripe Billing Portal',
  description:
    'Create and manage Stripe Billing Portal sessions for customer self-service, configure billing portal settings, and manage payment links.',
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
      description: 'Billing portal operation to perform',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Customer ID (required for create_session)',
    },
    sessionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing portal session ID (for retrieve)',
    },
    configurationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Billing portal configuration ID',
    },
    returnUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL to return to after session ends',
    },
    locale: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Session locale (auto, de, en, es, fr, it, ja, ko, pl, pt, zh)',
    },
    onBehalfOf: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Account ID when using connected accounts',
    },
    paymentLinkId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Payment link ID (for retrieve)',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expand nested resources (comma-separated)',
    },
  },
  outputs: {
    session: {
      type: 'object',
      description: 'The billing portal session or configuration object',
      properties: {
        id: { type: 'string', description: 'Session or link ID' },
        object: { type: 'string', description: 'Object type' },
        url: { type: 'string', description: 'Portal session URL' },
        customer: { type: 'string', description: 'Associated customer ID' },
        created: { type: 'number', description: 'Unix timestamp of creation' },
        livemode: { type: 'boolean', description: 'Whether in live mode' },
      },
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
        case 'create_session':
          return `${baseUrl}/billing_portal/sessions`
        case 'retrieve_session':
          return `${baseUrl}/billing_portal/sessions/${params.sessionId}`
        case 'create_configuration':
          return `${baseUrl}/billing_portal/configurations`
        case 'retrieve_configuration':
          return `${baseUrl}/billing_portal/configurations/${params.configurationId}`
        case 'list_configurations':
          return `${baseUrl}/billing_portal/configurations`
        case 'update_configuration':
          return `${baseUrl}/billing_portal/configurations/${params.configurationId}`
        case 'create_payment_link':
          return `${baseUrl}/payment_links`
        case 'retrieve_payment_link':
          return `${baseUrl}/payment_links/${params.paymentLinkId}`
        case 'update_payment_link':
          return `${baseUrl}/payment_links/${params.paymentLinkId}`
        case 'list_payment_links':
          return `${baseUrl}/payment_links`
        default:
          throw new Error(`Unknown operation: ${operation}`)
      }
    },
    method: (params) => {
      const operation = params.operation as string
      switch (operation) {
        case 'retrieve_session':
        case 'retrieve_configuration':
        case 'list_configurations':
        case 'retrieve_payment_link':
        case 'list_payment_links':
          return 'GET'
        case 'create_session':
        case 'create_configuration':
        case 'create_payment_link':
        case 'update_configuration':
        case 'update_payment_link':
          return 'POST'
        default:
          return 'GET'
      }
    },
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(params.onBehalfOf && { 'Stripe-Account': params.onBehalfOf as string }),
    }),
    body: (params) => {
      const operation = params.operation as string
      const formData = new URLSearchParams()

      if (operation === 'create_session') {
        if (params.customerId) formData.append('customer', params.customerId as string)
        if (params.returnUrl) formData.append('return_url', params.returnUrl as string)
        if (params.locale) formData.append('locale', params.locale as string)
        if (params.configurationId)
          formData.append('configuration', params.configurationId as string)
      }

      if (params.expand) {
        formData.append('expand[]', params.expand as string)
      }

      return formData.toString()
    },
  },
}
