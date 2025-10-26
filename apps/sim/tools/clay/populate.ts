import type { ClayPopulateParams, ClayPopulateResponse } from '@/tools/clay/types'
import type { ToolConfig } from '@/tools/types'

export const clayPopulateTool: ToolConfig<ClayPopulateParams, ClayPopulateResponse> = {
  id: 'clay_populate',
  name: 'Clay Populate',
  description:
    'Populate Clay with data from a JSON file. Enables direct communication and notifications with timestamp tracking and channel confirmation.',
  version: '1.0.0',

  params: {
    webhookURL: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The webhook URL to populate',
    },
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'The data to populate',
    },
    authToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional auth token for Clay webhook authentication (most webhooks do not require this)',
    },
  },

  request: {
    url: (params: ClayPopulateParams) => params.webhookURL,
    method: 'POST',
    headers: (params: ClayPopulateParams) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (params.authToken && params.authToken.trim() !== '') {
        headers['x-clay-webhook-auth'] = params.authToken
      }

      return headers
    },
    body: (params: ClayPopulateParams) => ({
      data: params.data,
    }),
  },

  transformResponse: async (response: Response) => {
    const contentType = response.headers.get('content-type')
    const timestamp = new Date().toISOString()

    // Extract response headers
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    // Parse response body
    let responseData
    if (contentType?.includes('application/json')) {
      responseData = await response.json()
    } else {
      responseData = await response.text()
    }

    return {
      success: true,
      output: {
        data: contentType?.includes('application/json') ? responseData : { message: responseData },
        metadata: {
          status: response.status,
          statusText: response.statusText,
          headers: headers,
          timestamp: timestamp,
          contentType: contentType || 'unknown',
        },
      },
    }
  },

  outputs: {
    data: {
      type: 'json',
      description: 'Response data from Clay webhook',
    },
    metadata: {
      type: 'object',
      description: 'Webhook response metadata',
      properties: {
        status: { type: 'number', description: 'HTTP status code' },
        statusText: { type: 'string', description: 'HTTP status text' },
        headers: { type: 'object', description: 'Response headers from Clay' },
        timestamp: { type: 'string', description: 'ISO timestamp when webhook was received' },
        contentType: { type: 'string', description: 'Content type of the response' },
      },
    },
  },
}
