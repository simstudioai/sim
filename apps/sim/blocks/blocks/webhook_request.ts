import { createHmac } from 'crypto'
import { createLogger } from '@sim/logger'
import { v4 as uuidv4 } from 'uuid'
import { WebhookIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { RequestResponse } from '@/tools/http/types'

const logger = createLogger('WebhookRequestBlock')

/**
 * Generates HMAC-SHA256 signature for webhook payload
 */
function generateSignature(secret: string, timestamp: number, body: string): string {
  const signatureBase = `${timestamp}.${body}`
  return createHmac('sha256', secret).update(signatureBase).digest('hex')
}

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
    access: ['http_request'],
    config: {
      tool: () => 'http_request',
      params: (params: Record<string, any>) => {
        const timestamp = Date.now()
        const deliveryId = uuidv4()

        // Start with webhook-specific headers
        const webhookHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-Timestamp': timestamp.toString(),
          'X-Delivery-ID': deliveryId,
          'Idempotency-Key': deliveryId,
        }

        // Add signature if secret is provided
        if (params.secret) {
          const bodyString =
            typeof params.body === 'string' ? params.body : JSON.stringify(params.body || {})
          const signature = generateSignature(params.secret, timestamp, bodyString)
          webhookHeaders['X-Webhook-Signature'] = `t=${timestamp},v1=${signature}`
        }

        // Merge with user-provided headers (user headers take precedence)
        // Headers must be in TableRow format: { cells: { Key: string, Value: string } }
        const userHeaders = params.headers || []
        const mergedHeaders = [
          ...Object.entries(webhookHeaders).map(([key, value]) => ({
            cells: { Key: key, Value: value },
          })),
          ...userHeaders,
        ]

        const payload = {
          url: params.url,
          method: 'POST',
          headers: mergedHeaders,
          body: params.body,
        }

        logger.info('Sending webhook request', {
          url: payload.url,
          method: payload.method,
          headers: mergedHeaders,
          body: payload.body,
          hasSignature: !!params.secret,
        })

        return payload
      },
    },
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

