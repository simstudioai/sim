import { WebhookIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const genericWebhookTrigger: TriggerConfig = {
  id: 'generic_webhook',
  name: 'Generic Webhook',
  provider: 'generic',
  description: 'Receive webhooks from any service or API',
  version: '1.0.0',
  icon: WebhookIcon,

  configFields: {
    requireAuth: {
      type: 'boolean',
      label: 'Require Authentication',
      description: 'Require authentication for all webhook requests',
      defaultValue: false,
    },
    token: {
      type: 'string',
      label: 'Authentication Token',
      placeholder: 'Enter an auth token',
      description: 'Token used to authenticate webhook requests via Bearer token or custom header',
      required: false,
      isSecret: true,
    },
    secretHeaderName: {
      type: 'string',
      label: 'Secret Header Name (Optional)',
      placeholder: 'X-Secret-Key',
      description:
        'Custom HTTP header name for the auth token. If blank, uses "Authorization: Bearer TOKEN"',
      required: false,
    },
  },

  outputs: {
    payload: {
      type: 'json',
      description: 'Complete webhook payload received',
    },
    headers: {
      type: 'json',
      description: 'HTTP request headers',
    },
    method: {
      type: 'string',
      description: 'HTTP method (GET, POST, PUT, etc.)',
    },
    url: {
      type: 'string',
      description: 'Request URL path',
    },
    query: {
      type: 'json',
      description: 'URL query parameters',
    },
    timestamp: {
      type: 'string',
      description: 'Webhook received timestamp',
    },
    // Common fields that many services use
    event: {
      type: 'string',
      description: 'Event type (extracted from payload.event, payload.type, or payload.event_type)',
    },
    id: {
      type: 'string',
      description: 'Event ID (extracted from payload.id, payload.event_id, or payload.uuid)',
    },
    data: {
      type: 'json',
      description: 'Event data (extracted from payload.data or the full payload)',
    },
  },

  instructions: [
    'Copy the webhook URL provided above and use it in your external service or API.',
    'Configure your service to send webhooks to this URL.',
    'The webhook will receive any HTTP method (GET, POST, PUT, DELETE, etc.).',
    'All request data (headers, body, query parameters) will be available in your workflow.',
    'If authentication is enabled, include the token in requests using either the custom header or "Authorization: Bearer TOKEN".',
    'Common fields like "event", "id", and "data" will be automatically extracted from the payload when available.',
  ],

  samplePayload: {
    event: 'user.created',
    id: 'evt_1234567890',
    data: {
      user: {
        id: 'user_123',
        email: 'user@example.com',
        name: 'John Doe',
      },
    },
    timestamp: '2023-01-01T12:00:00Z',
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
