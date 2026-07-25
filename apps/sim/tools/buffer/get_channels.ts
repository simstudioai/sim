import {
  BUFFER_API_URL,
  type BufferChannelsResponse,
  type BufferGetChannelsParams,
  bufferHeaders,
  CHANNEL_OUTPUT_PROPERTIES,
  mapBufferChannel,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const GET_CHANNELS_QUERY = `
  query GetChannels($input: ChannelsInput!) {
    channels(input: $input) {
      id
      name
      displayName
      service
      serviceId
      avatar
      timezone
      type
      isQueuePaused
      isDisconnected
      organizationId
    }
  }
`

export const bufferGetChannelsTool: ToolConfig<BufferGetChannelsParams, BufferChannelsResponse> = {
  id: 'buffer_get_channels',
  name: 'Buffer Get Channels',
  description:
    'List the social media channels connected to a Buffer organization, including their channel IDs (needed to create posts)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key',
    },
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Buffer organization ID (find it with the Get Account operation)',
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: GET_CHANNELS_QUERY,
      variables: {
        input: { organizationId: params.organizationId },
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    return {
      success: true,
      output: {
        channels: (data.channels ?? []).map(mapBufferChannel),
      },
    }
  },

  outputs: {
    channels: {
      type: 'array',
      description: 'Channels connected to the organization',
      items: { type: 'object', properties: CHANNEL_OUTPUT_PROPERTIES },
    },
  },
}
