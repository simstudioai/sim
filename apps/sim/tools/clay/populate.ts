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
      required: true,
      visibility: 'user-only',
      description: 'Auth token for Clay webhook authentication',
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
    } else {
      data = await response.text()
    }

    return {
      success: true,
      output: {
        data: contentType?.includes('application/json') ? data : { message: data },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'json',
      description: 'Clay populate operation results including response data from Clay webhook',
    },
  },
}
