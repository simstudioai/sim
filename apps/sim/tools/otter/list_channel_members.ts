import type {
  OtterListChannelMembersParams,
  OtterListChannelMembersResponse,
  OtterUser,
} from '@/tools/otter/types'
import {
  mapOtterUser,
  OTTER_API_BASE,
  OTTER_RETRIEVED_AT_OUTPUT,
  OTTER_USER_PROPERTIES,
  otterHeaders,
  readOtterDataList,
  readOtterRetrievedAt,
} from '@/tools/otter/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const otterListChannelMembersTool: ToolConfig<
  OtterListChannelMembersParams,
  OtterListChannelMembersResponse
> = {
  id: 'otter_list_channel_members',
  name: 'Otter List Channel Members',
  description: 'List the members of an Otter channel, in alphabetical order.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Otter API key',
    },
    channelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Otter channel ID',
    },
  },

  request: {
    url: (params) =>
      `${OTTER_API_BASE}/channels/${safeUrlPathSegment(params.channelId, 'channelId')}/members`,
    method: 'GET',
    headers: (params) => otterHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const body = await response.json()
    return {
      success: true,
      output: {
        members: readOtterDataList(body)
          .map(mapOtterUser)
          .filter((member): member is OtterUser => member !== null),
        retrievedAt: readOtterRetrievedAt(body),
      },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Channel members, in alphabetical order by name',
      items: { type: 'object', properties: OTTER_USER_PROPERTIES },
    },
    retrievedAt: OTTER_RETRIEVED_AT_OUTPUT,
  },
}
