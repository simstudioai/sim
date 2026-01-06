import { WebhookIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { RequestResponse } from '@/tools/http/types'

export const WebhookRequestBlock: BlockConfig<RequestResponse> = {
  type: 'webhook_request',
  name: 'Webhook',
  description: 'Send a webhook request',
  longDescription:
    'Send an HTTP POST request to a webhook URL with automatic webhook headers. Optionally sign the payload with HMAC-SHA256 for secure webhook delivery.',
  docsLink: 'https://docs.sim.ai/blocks/webhook',
  category: 'blocks',
  bgColor: '#10B981',
  icon: WebhookIcon,
  subBlocks: [
    {
      id: 'url',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'https://example.com/webhook',
      required: true,
    },
    {
      id: 'body',
      title: 'Payload',
      type: 'code',
      placeholder: 'Enter JSON payload...',
      language: 'json',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert JSON programmer.
Generate ONLY the raw JSON object based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.

Current payload: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

You have access to the following variables you can use to generate the JSON payload:
- Use angle brackets for workflow variables, e.g., '<blockName.output>'.
- Use double curly braces for environment variables, e.g., '{{ENV_VAR_NAME}}'.

Example:
{
  "event": "workflow.completed",
  "data": {
    "result": "<agent.content>",
    "timestamp": "<function.result>"
  }
}`,
        placeholder: 'Describe the webhook payload you need...',
        generationType: 'json-object',
      },
    },
    {
      id: 'secret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'Optional: Secret for HMAC signature',
      password: true,
      connectionDroppable: false,
    },
    {
      id: 'headers',
      title: 'Additional Headers',
      type: 'table',
      columns: ['Key', 'Value'],
      description: 'Optional custom headers to include with the webhook request',
    },
  ],
  tools: {
    access: ['webhook_request'],
  },
  inputs: {
    url: { type: 'string', description: 'Webhook URL to send the request to' },
    body: { type: 'json', description: 'JSON payload to send' },
    secret: { type: 'string', description: 'Optional secret for HMAC-SHA256 signature' },
    headers: { type: 'json', description: 'Optional additional headers' },
  },
  outputs: {
    data: { type: 'json', description: 'Response data from the webhook endpoint' },
    status: { type: 'number', description: 'HTTP status code' },
    headers: { type: 'json', description: 'Response headers' },
  },
}
