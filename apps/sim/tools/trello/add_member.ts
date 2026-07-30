import { env } from '@/lib/core/config/env'
import { extractTrelloErrorMessage, getIdArray, TRELLO_API_BASE_URL } from '@/tools/trello/shared'
import type { TrelloAddMemberParams, TrelloAddMemberResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloAddMemberTool: ToolConfig<TrelloAddMemberParams, TrelloAddMemberResponse> = {
  id: 'trello_add_member',
  name: 'Trello Add Member',
  description: 'Assign a member to a Trello card',
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
    cardId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Trello card ID to assign the member to (24-character hex string)',
    },
    memberId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the member to assign (24-character hex string)',
    },
  },

  request: {
    url: (params) => {
      if (!params.cardId) {
        throw new Error('Card ID is required')
      }
      if (!params.memberId) {
        throw new Error('Member ID is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/cards/${params.cardId.trim()}/idMembers`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)
      url.searchParams.set('value', params.memberId.trim())

      return url.toString()
    },
    method: 'POST',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to add member')

      return {
        success: false,
        output: {
          memberIds: [],
          error,
        },
        error,
      }
    }

    return {
      success: true,
      output: {
        memberIds: getIdArray(data),
      },
    }
  },

  outputs: {
    memberIds: {
      type: 'array',
      description: 'Member IDs now assigned to the card',
      items: {
        type: 'string',
        description: 'A Trello member ID',
      },
    },
  },
}
