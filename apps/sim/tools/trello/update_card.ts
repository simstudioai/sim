import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import {
  extractTrelloErrorMessage,
  mapTrelloCard,
  TRELLO_API_BASE_URL,
} from '@/tools/trello/shared'
import type { TrelloUpdateCardParams, TrelloUpdateCardResponse } from '@/tools/trello/types'
import { TRELLO_CARD_OUTPUT_PROPERTIES } from '@/tools/trello/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/** Joins an ID array, or trims a comma-separated ID string, into Trello's comma-separated form. */
function joinIdList(ids: string[] | string | undefined): string {
  if (Array.isArray(ids)) return ids.join(',')
  return typeof ids === 'string' ? ids.trim() : ''
}

export const trelloUpdateCardTool: ToolConfig<TrelloUpdateCardParams, TrelloUpdateCardResponse> = {
  id: 'trello_update_card',
  name: 'Trello Update Card',
  description: 'Update an existing card on Trello',
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
      description: 'Trello card ID (24-character hex string)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name/title of the card',
    },
    desc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description of the card',
    },
    closed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Archive/close the card (true) or reopen it (false)',
    },
    idList: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trello list ID to move card to (24-character hex string)',
    },
    due: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date (ISO 8601 format)',
    },
    dueComplete: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Mark the due date as complete',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date (ISO 8601 format)',
    },
    pos: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Position of the card in its list (top, bottom, or positive float)',
    },
    idBoard: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trello board ID to move the card to (use with idList)',
    },
    labelIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replace the card labels with these label IDs (array or comma-separated string). An empty list leaves labels unchanged; use Remove Label to take one off',
      items: {
        type: 'string',
        description: 'A Trello label ID',
      },
    },
    memberIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replace the card members with these member IDs (array or comma-separated string). An empty list leaves members unchanged; use Remove Member to take one off',
      items: {
        type: 'string',
        description: 'A Trello member ID',
      },
    },
  },

  request: {
    url: (params) => {
      if (!params.cardId) {
        throw new Error('Card ID is required')
      }
      const apiKey = env.TRELLO_API_KEY

      if (!apiKey) {
        throw new Error('TRELLO_API_KEY environment variable is not set')
      }

      const url = new URL(
        `${TRELLO_API_BASE_URL}/cards/${safeUrlPathSegment(params.cardId, 'cardId')}`
      )
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', params.accessToken)

      return url.toString()
    },
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.name !== undefined) body.name = params.name
      if (params.desc !== undefined) body.desc = params.desc
      if (params.closed !== undefined) body.closed = params.closed
      if (params.idList !== undefined) body.idList = params.idList.trim()
      if (params.due !== undefined) body.due = params.due
      if (params.dueComplete !== undefined) body.dueComplete = params.dueComplete
      if (params.start !== undefined) body.start = params.start
      if (params.pos !== undefined) body.pos = params.pos
      if (params.idBoard !== undefined) body.idBoard = params.idBoard.trim()
      const idLabels = joinIdList(params.labelIds)
      if (idLabels) body.idLabels = idLabels
      const idMembers = joinIdList(params.memberIds)
      if (idMembers) body.idMembers = idMembers

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field must be provided to update')
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractTrelloErrorMessage(response, data, 'Failed to update card')

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
      const message = getErrorMessage(error, 'Failed to parse updated card')

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
        'Updated card (id, name, desc, url, shortUrl, shortLink, idShort, idBoard, idList, closed, pos, labelIds, labels, idMembers, idChecklists, due, start, dueComplete, dateLastActivity, badges, checklists, attachments, members)',
      optional: true,
      properties: TRELLO_CARD_OUTPUT_PROPERTIES,
    },
  },
}
