import { generateId } from '@sim/utils/id'
import { WebhookIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const genericWebhookTrigger: TriggerConfig = {
  id: 'generic_webhook',
  name: 'Webhook Trigger',
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
      defaultValue: true,
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
      value: () => generateId(),
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
      id: 'idempotencyField',
      title: 'Deduplication Field (Optional)',
      type: 'short-input',
      placeholder: 'e.g. event.id',
      description:
        'Dot-notation path to a unique field in the payload for deduplication. If the same value is seen within 7 days, the duplicate webhook will be skipped.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'responseMode',
      title: 'Acknowledgement',
      type: 'dropdown',
      options: [
        { label: 'Default', id: 'default' },
        { label: 'Custom', id: 'custom' },
      ],
      defaultValue: 'default',
      mode: 'trigger',
    },
    {
      id: 'verifyTestEvents',
      title: 'Verify Test Events',
      type: 'switch',
      description:
        'Return a temporary 200 response for test or verification probes on this webhook URL during setup.',
      defaultValue: false,
      mode: 'trigger',
    },
    {
      id: 'responseStatusCode',
      title: 'Response Status Code',
      type: 'short-input',
      placeholder: '200 (default)',
      description:
        'HTTP status code (100–599) to return to the webhook caller. Defaults to 200 if empty or invalid.',
      required: false,
      mode: 'trigger',
      condition: { field: 'responseMode', value: 'custom' },
    },
    {
      id: 'responseBody',
      title: 'Response Body',
      type: 'code',
      language: 'json',
      placeholder: '{"ok": true}',
      description: 'JSON body to return to the webhook caller. Leave empty for no body.',
      required: false,
      mode: 'trigger',
      condition: { field: 'responseMode', value: 'custom' },
    },
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
      description:
        'Define the expected JSON input schema for this webhook (optional). Use type "file[]" for file uploads.',
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
        'The webhook accepts GET, POST, PUT, PATCH and DELETE requests. Use GET to trigger the workflow from a plain URL, such as a link in an email.',
        'Body fields are available in your workflow, and the request method, headers and query parameters are available under "method", "headers" and "query" (for example "headers.x-event-name", "query.id"). Headers that carry credentials are withheld.',
        'If authentication is enabled, include the token in the Secret Header Name you configured, or in "Authorization: Bearer TOKEN" if you left it blank. Only the configured method is accepted.',
        'To deduplicate incoming events, set the Deduplication Field to the dot-notation path of a unique identifier in the payload (e.g. "event.id"). Duplicate values within 7 days will be skipped.',
        'Enable "Verify Test Events" only if the sending service needs a temporary 200 response while validating the webhook URL.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  /**
   * Body fields stay undeclared because a generic webhook receives whatever JSON the caller
   * sends. The request metadata below is known ahead of time, so it can be offered for reference.
   */
  outputs: {
    method: {
      type: 'string',
      description: 'HTTP method of the request (GET, POST, PUT, PATCH or DELETE)',
    },
    query: {
      type: 'object',
      description: 'Query parameters from the request URL',
    },
    headers: {
      type: 'object',
      description: 'Request headers, excluding the ones that carry credentials',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
