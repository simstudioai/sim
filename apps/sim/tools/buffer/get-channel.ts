import { bufferOutputProperties, bufferSelection } from '@/tools/buffer/schema'
import {
  BUFFER_API_URL,
  type BufferChannelResponse,
  type BufferGetChannelParams,
  bufferHeaders,
  mapBufferChannel,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

export const bufferGetChannelTool: ToolConfig<BufferGetChannelParams, BufferChannelResponse> = {
  id: 'buffer_get_channel',
  name: 'Buffer Get Channel',
  description:
    'Get one connected channel, including its posting schedule, limits and network settings',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key with account:read permission',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Buffer channel ID',
    },
  },
  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: `query GetChannel($input: ChannelInput!) { channel(input: $input) { ${bufferSelection('Channel')} } }`,
      variables: { input: { id: params.channelId } },
    }),
  },
  transformResponse: async (response) => {
    const data = await parseBufferGraphQLResponse(response)
    if (!data.channel) throw new Error('Buffer channel not found')
    return { success: true, output: { channel: mapBufferChannel(data.channel) } }
  },
  outputs: {
    channel: {
      type: 'object',
      description: 'Connected channel',
      properties: bufferOutputProperties('Channel'),
    },
  },
}
