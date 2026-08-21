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
      id: 'acceptOtherMethods',
      title: 'Accept Other HTTP Methods',
      type: 'switch',
      description:
        'Also accept GET, PUT, PATCH and DELETE — no others — and expose the method under "method". Leave off unless you need it: a GET URL can be replayed by link prefetchers and scanners, and a request with no body cannot be deduplicated.',
      defaultValue: false,
      mode: 'trigger',
    },
    {
      id: 'exposeRequestHeaders',
      title: 'Expose Request Headers',
      type: 'switch',
      description:
        'Make the request headers available under "headers". Headers that carry credentials are withheld. Leave off unless you need it: exposed headers are stored in execution logs and trace spans, where they outlive the request.',
      defaultValue: false,
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
        'The webhook accepts POST. Turn on "Accept Other HTTP Methods" to also accept GET, PUT, PATCH and DELETE — for example to trigger the workflow from a link in an email.',
        'Body fields are available in your workflow, and URL query parameters under "query" (for example "query.id"). Turn on "Expose Request Headers" to also get "headers" (for example "headers.x-event-name"), and "Accept Other HTTP Methods" to also get "method".',
        'Authentication is header-based, so it cannot be used with a plain link. If authentication is enabled, include the token in the Secret Header Name you configured, or in "Authorization: Bearer TOKEN" if you left it blank — only the configured one is accepted, not either.',
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
   * Deliberately empty, and it must stay that way.
   *
   * A generic webhook receives whatever the caller sends, so its output shape is unknowable. The
   * executor treats any non-empty output declaration as an exhaustive schema: `collectBlockData`
   * registers it, and `resolveBlockReference` then throws `InvalidFieldError` for any reference
   * outside it that resolves to `undefined`. Declaring `method`, `query` and `headers` here
   * therefore did not add three completions — it made those three the *only* legal fields, and
   * every workflow reading a body field failed the moment a delivery omitted it.
   *
   * The metadata is still merged into the input at delivery time by the generic provider's
   * `formatInput`; it is only undeclared, which is what keeps the block's shape open. Offering
   * these as editor completions needs a way to mark outputs as hints rather than a closed schema,
   * which is a change to `getRegistrySchema`, not to this list.
   */
  outputs: {},

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
