import { WebhookIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const genericWebhookTrigger: TriggerConfig = {
  id: 'generic_webhook',
  name: 'Generic Webhook',
  provider: 'generic',
  description: 'Receive webhooks from any service or API',
  version: '1.0.0',
  icon: WebhookIcon,

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    },
    {
      id: 'requireAuth',
      title: 'Require Authentication',
      type: 'switch',
      description: 'Require authentication for all webhook requests',
      defaultValue: false,
      mode: 'trigger',
    },
    {
      id: 'token',
      title: 'Authentication Token',
      type: 'short-input',
      placeholder: 'Enter an auth token',
      description: 'Token used to authenticate webhook requests via Bearer token or custom header',
      password: true,
      required: false,
      mode: 'trigger',
    },
    {
      id: 'secretHeaderName',
      title: 'Secret Header Name (Optional)',
      type: 'short-input',
      placeholder: 'X-Secret-Key',
      description:
        'Custom HTTP header name for the auth token. If blank, uses "Authorization: Bearer TOKEN"',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
      description:
        'Define the expected JSON input schema for this webhook (optional). Use type "files" for file uploads.',
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Copy the webhook URL and use it in your external service or API.',
        'Configure your service to send webhooks to this URL.',
        'The webhook will receive any HTTP method (GET, POST, PUT, DELETE, etc.).',
        'All request data (headers, body, query parameters) will be available in your workflow.',
        'If authentication is enabled, include the token in requests using either the custom header or "Authorization: Bearer TOKEN".',
        'Common fields like "event", "id", and "data" will be automatically extracted from the payload when available.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'generic_webhook',
    },
  ],

  outputs: {},

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
