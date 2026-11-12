import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloCard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloCreateCardParams, TrelloCreateCardResponse } from '@/tools/trello/types'
import { TRELLO_CARD_OUTPUT_PROPERTIES } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'

export const trelloCreateCardTool: ToolConfig<TrelloCreateCardParams, TrelloCreateCardResponse> = {
  id: 'trello_create_card',
  name: 'Trello Create Card',
  description: 'Create a new card in a Trello list',
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
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Trello list ID (24-character hex string)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name/title of the card',
    },
    desc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the card',
    },
    pos: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position of the card (top, bottom, or positive float)',
    },
    due: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date (ISO 8601 format)',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date (ISO 8601 format)',
    },
    dueComplete: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the due date should be marked complete',
    },
    labelIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label IDs to attach to the card',
      items: {
        type: 'string',
        description: 'A Trello label ID',
      },
    },
    memberIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Member IDs to assign to the card',
      items: {
        type: 'string',
        description: 'A Trello member ID',
      },
    },
  },

  request: {
    url: (params) => {
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(`${TRELLO_API_BASE_URL}/cards`)
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

      return url.toString()
    },
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      if (!params.name) {
        throw new Error('Card name is required')
      }
      if (!params.listId) {
        throw new Error('List ID is required')
      }

      const body: Record<string, unknown> = {
        idList: params.listId.trim(),
        name: params.name,
      }

      if (params.desc) body.desc = params.desc
      if (params.pos) body.pos = params.pos
      if (params.due) body.due = params.due
      if (params.start) body.start = params.start
      if (params.dueComplete !== undefined) body.dueComplete = params.dueComplete
      if (params.labelIds?.length) body.idLabels = params.labelIds
      if (params.memberIds?.length) body.idMembers = params.memberIds

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to create card')

      return {
        success: false,
        output: {
          error,
        },
        error,
      }
    }

    try {
      const card = mapTrelloCard(data)

      return {
        success: true,
        output: {
          card,
        },
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to parse created card')

      return {
        success: false,
        output: {
          error: message,
        },
        error: message,
      }
    }
  },

  outputs: {
    card: {
      type: 'json',
      description:
        'Created card (id, name, desc, url, shortUrl, shortLink, idShort, idBoard, idList, closed, pos, labelIds, labels, idMembers, idChecklists, due, start, dueComplete, dateLastActivity, badges, checklists, attachments, members)',
      optional: true,
      properties: TRELLO_CARD_OUTPUT_PROPERTIES,
    },
  },
}
