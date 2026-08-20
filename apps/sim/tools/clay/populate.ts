import type { ToolConfig } from '../types'
import type { ClayPopulateParams, ClayPopulateResponse } from './types'

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
      requiredForToolCall: true,
      description: 'The webhook URL to populate',
    },
    data: {
      type: 'json',
      required: true,
      description: 'The data to populate',
      optionalToolInput: true,
    },
    authToken: {
      type: 'string',
      required: false,
      description: 'Optional auth token for WebhookURL',
    },
  },

  request: {
    url: (params: ClayPopulateParams) => params.webhookURL,
    method: 'POST',
    headers: (params: ClayPopulateParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.authToken}`,
    }),
    body: (params: ClayPopulateParams) => ({
      data: params.data,
    }),
  },

  transformResponse: async (response: Response) => {
    const contentType = response.headers.get('content-type')
    let data

    if (contentType?.includes('application/json')) {
      data = await response.json()
      if (!data.ok) {
        throw new Error(data.error || 'Clay API error')
      }
    } else {
      // Handle text response
      data = await response.text()
      if (data !== 'OK' && !response.ok) {
        throw new Error(data || 'Clay API error')
      }
    }

    return {
      success: true,
      output: {
        data: contentType?.includes('application/json') ? data : { message: data },
      },
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Clay populate failed'
    return message
  },
}
