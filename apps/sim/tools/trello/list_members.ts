import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloMember,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloListMembersParams, TrelloListMembersResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloListMembersTool: ToolConfig<TrelloListMembersParams, TrelloListMembersResponse> =
  {
    id: 'trello_list_members',
    name: 'Trello List Members',
    description: 'List members of a Trello board',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'trello',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Trello OAuth access token',
      },
      boardId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Trello board ID (24-character hex string)',
      },
    },

    request: {
      url: (params) => {
        if (!params.boardId) {
          throw new Error('Board ID is required')
        }
        const apiKey = env.TRELLO_API_KEY

        if (!apiKey) {
          throw new Error('TRELLO_API_KEY environment variable is not set')
        }

        const url = new URL(`${TRELLO_API_BASE_URL}/boards/${params.boardId.trim()}/members`)
        url.searchParams.set('key', apiKey)
        url.searchParams.set('token', params.accessToken)

        return url.toString()
      },
      method: 'GET',
      headers: () => ({
        Accept: 'application/json',
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const error = extractTrelloErrorMessage(response, data, 'Failed to list board members')

        return {
          success: false,
          output: {
            members: [],
            count: 0,
            error,
          },
          error,
        }
      }

      if (!Array.isArray(data)) {
        const error = 'Trello returned an invalid member collection'

        return {
          success: false,
          output: {
            members: [],
            count: 0,
            error,
          },
          error,
        }
      }

      try {
        const members = data
          .map((item) => mapTrelloMember(item))
          .filter((member): member is NonNullable<typeof member> => member !== null)

        return {
          success: true,
          output: {
            members,
            count: members.length,
          },
        }
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to parse board members')

        return {
          success: false,
          output: {
            members: [],
            count: 0,
            error: message,
          },
          error: message,
        }
      }
    },

    outputs: {
      members: {
        type: 'array',
        description: 'Members on the selected board',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Member ID' },
            fullName: { type: 'string', description: 'Member full name', optional: true },
            username: { type: 'string', description: 'Member username', optional: true },
          },
        },
      },
      count: { type: 'number', description: 'Number of members returned' },
    },
  }
