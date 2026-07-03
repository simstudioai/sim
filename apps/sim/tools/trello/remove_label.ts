import { env } from '@/lib/core/config/env'
import { extractTrelloErrorMessage, TRELLO_API_BASE_URL } from '@/tools/trello/shared'
import type { TrelloRemoveLabelParams, TrelloRemoveLabelResponse } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloRemoveLabelTool: ToolConfig<TrelloRemoveLabelParams, TrelloRemoveLabelResponse> =
  {
    id: 'trello_remove_label',
    name: 'Trello Remove Label',
    description: 'Detach a label from a Trello card',
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
        description: 'Trello card ID to detach the label from (24-character hex string)',
      },
      labelId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the label to detach (24-character hex string)',
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

        const url = new URL(
          `${TRELLO_API_BASE_URL}/cards/${params.cardId.trim()}/idLabels/${params.labelId.trim()}`
        )
        url.searchParams.set('key', apiKey)
        url.searchParams.set('token', params.accessToken)

        return url.toString()
      },
      method: 'DELETE',
      headers: () => ({
        Accept: 'application/json',
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const error = extractTrelloErrorMessage(response, data, 'Failed to remove label')

        return {
          success: false,
          output: {
            success: false,
            error,
          },
          error,
        }
      }

      return {
        success: true,
        output: {
          success: true,
        },
      }
    },

    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the label was removed from the card',
      },
    },
  }
