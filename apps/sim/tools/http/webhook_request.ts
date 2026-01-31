import { createHmac } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import type { RequestResponse, WebhookRequestParams } from '@/tools/http/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Generates HMAC-SHA256 signature for webhook payload
 */
function generateSignature(secret: string, timestamp: number, body: string): string {
  const signatureBase = `${timestamp}.${body}`
  return createHmac('sha256', secret).update(signatureBase).digest('hex')
}

export const webhookRequestTool: ToolConfig<WebhookRequestParams, RequestResponse> = {
  id: 'webhook_request',
  name: 'Webhook Request',
  description: 'Send a webhook request with automatic headers and optional HMAC signing',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The webhook URL to send the request to',
    },
    body: {
      type: 'object',
      visibility: 'user-or-llm',
      description: 'JSON payload to send',
    },
    secret: {
      type: 'string',
      visibility: 'user-or-llm',
      description: 'Optional secret for HMAC-SHA256 signature',
    },
    headers: {
      type: 'object',
      visibility: 'user-or-llm',
      description: 'Additional headers to include',
    },
  },

  request: {
    url: (params: WebhookRequestParams) => params.url,

    method: () => 'POST',

    headers: (params: WebhookRequestParams) => {
      const timestamp = Date.now()
      const deliveryId = uuidv4()

      const webhookHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-Timestamp': timestamp.toString(),
        'X-Delivery-ID': deliveryId,
        'Idempotency-Key': deliveryId,
      }

      if (params.secret) {
        const bodyString =
          typeof params.body === 'string' ? params.body : JSON.stringify(params.body || {})
        const signature = generateSignature(params.secret, timestamp, bodyString)
        webhookHeaders['X-Webhook-Signature'] = `t=${timestamp},v1=${signature}`
      }

      const userHeaders = params.headers || {}

      return { ...webhookHeaders, ...userHeaders }
    },

    body: (params: WebhookRequestParams) => params.body as Record<string, any>,
  },

  transformResponse: async (response: Response) => {
    const contentType = response.headers.get('content-type') || ''

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    const data = await (contentType.includes('application/json')
      ? response.json()
      : response.text())

    if (
      contentType.includes('application/json') &&
      typeof data === 'object' &&
      data !== null &&
      data.data !== undefined &&
      data.status !== undefined
    ) {
      return {
        success: data.success,
        output: {
          data: data.data,
          status: data.status,
          headers: data.headers || {},
        },
        error: data.success ? undefined : data.error,
      }
    }

    return {
      success: response.ok,
      output: {
        data,
        status: response.status,
        headers,
      },
      error: undefined,
    }
  },

  outputs: {
    data: {
      type: 'json',
      description: 'Response data from the webhook endpoint',
    },
    status: {
      type: 'number',
      description: 'HTTP status code',
    },
    headers: {
      type: 'object',
      description: 'Response headers',
    },
  },
}
