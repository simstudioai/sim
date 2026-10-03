import type {
  OtterChannel,
  OtterListChannelsParams,
  OtterListChannelsResponse,
} from '@/tools/otter/types'
import {
  mapOtterChannel,
  OTTER_API_BASE,
  OTTER_CHANNEL_PROPERTIES,
  OTTER_RETRIEVED_AT_OUTPUT,
  otterHeaders,
  readOtterDataList,
  readOtterRetrievedAt,
} from '@/tools/otter/utils'
import type { ToolConfig } from '@/tools/types'

export const otterListChannelsTool: ToolConfig<OtterListChannelsParams, OtterListChannelsResponse> =
  {
    id: 'otter_list_channels',
    name: 'Otter List Channels',
    description:
      'List the Otter channels available to the authenticated user, in alphabetical order.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Otter API key',
      },
    },

    request: {
      url: `${OTTER_API_BASE}/channels`,
      method: 'GET',
      headers: (params) => otterHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const body = await response.json()
      return {
        success: true,
        output: {
          channels: readOtterDataList(body)
            .map(mapOtterChannel)
            .filter((channel): channel is OtterChannel => channel !== null),
          retrievedAt: readOtterRetrievedAt(body),
        },
      }
    },

    outputs: {
      channels: {
        type: 'array',
        description: 'Channels, in alphabetical order by name',
        items: { type: 'object', properties: OTTER_CHANNEL_PROPERTIES },
      },
      retrievedAt: OTTER_RETRIEVED_AT_OUTPUT,
    },
  }
