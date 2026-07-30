import { env } from '@/lib/core/config/env'
import { extractTrelloErrorMessage, getIdArray, TRELLO_API_BASE_URL } from '@/tools/trello/shared'
import type { TrelloAddLabelParams, TrelloAddLabelResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloAddLabelTool: ToolConfig<TrelloAddLabelParams, TrelloAddLabelResponse> = {
  id: 'trello_add_label',
  name: 'Trello Add Label',
  description: 'Attach an existing label to a Trello card',
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
      description: 'Trello card ID to attach the label to (24-character hex string)',
    },
    labelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the label to attach (24-character hex string)',
    },
  },

  request: {
    url: (params) => {
      if (!params.cardId) {
        throw new Error('Card ID is required')
      }
      if (!params.labelId) {
        throw new Error('Label ID is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/cards/${params.cardId.trim()}/idLabels`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)
      url.searchParams.set('value', params.labelId.trim())

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
      const error = extractTrelloErrorMessage(response, data, 'Failed to add label')

      return {
        success: false,
        output: {
          labelIds: [],
          error,
        },
        error,
      }
    }

    return {
      success: true,
      output: {
        labelIds: getIdArray(data),
      },
    }
  },

  outputs: {
    labelIds: {
      type: 'array',
      description: 'Label IDs now applied to the card',
      items: {
        type: 'string',
        description: 'A Trello label ID',
      },
    },
  },
}
