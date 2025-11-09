import { TrelloIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Trello Block
 *
 * Note: Trello uses OAuth 1.0a authentication with a unique credential ID format
 * (non-UUID strings like CUID2). This is different from most OAuth 2.0 providers
 * that use UUID-based credential IDs. The OAuth credentials API has been updated
 * to accept both UUID and non-UUID credential ID formats to support Trello.
 */
export const TrelloBlock: BlockConfig<ToolResponse> = {
  type: 'trello',
  name: 'Trello',
  description: 'Manage Trello boards and cards',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with Trello to manage boards and cards. List boards, list cards, create cards, update cards, get actions, and add comments.',
  docsLink: 'https://docs.sim.ai/tools/trello',
  category: 'tools',
  bgColor: '#0052CC',
  icon: TrelloIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Lists', id: 'trello_list_lists' },
        { label: 'List Cards', id: 'trello_list_cards' },
        { label: 'Create Card', id: 'trello_create_card' },
        { label: 'Update Card', id: 'trello_update_card' },
        { label: 'Get Actions', id: 'trello_get_actions' },
        { label: 'Add Comment', id: 'trello_add_comment' },
      ],
      value: () => 'trello_list_lists',
    },
    {
      id: 'credential',
      title: 'Trello Account',
      type: 'oauth-input',
      provider: 'trello',
      serviceId: 'trello',
      requiredScopes: ['read', 'write'],
      placeholder: 'Select Trello account',
      required: true,
    },

    {
      id: 'boardId',
      title: 'Board',
      type: 'short-input',
      placeholder: 'Enter board ID',
      condition: {
        field: 'operation',
        value: 'trello_list_lists',
      },
      required: true,
    },
    {
      id: 'boardId',
      title: 'Board',
      type: 'short-input',
      placeholder: 'Enter board ID or search for a board',
      condition: {
        field: 'operation',
        value: 'trello_list_cards',
      },
      required: true,
    },
    {
      id: 'listId',
      title: 'List (Optional)',
      type: 'short-input',
      placeholder: 'Enter list ID to filter cards by list',
      condition: {
        field: 'operation',
        value: 'trello_list_cards',
      },
    },
    {
      id: 'boardId',
      title: 'Board',
      type: 'short-input',
      placeholder: 'Enter board ID or search for a board',
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
      required: true,
    },
    {
      id: 'listId',
      title: 'List',
      type: 'short-input',
      placeholder: 'Enter list ID or search for a list',
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
      required: true,
    },

    {
      id: 'name',
      title: 'Card Name',
      type: 'short-input',
      placeholder: 'Enter card name/title',
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
      required: true,
    },

    {
      id: 'desc',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter card description (optional)',
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
    },

    {
      id: 'pos',
      title: 'Position',
      type: 'dropdown',
      options: [
        { label: 'Top', id: 'top' },
        { label: 'Bottom', id: 'bottom' },
      ],
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
    },

    {
      id: 'due',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD or ISO 8601',
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
    },

    {
      id: 'labels',
      title: 'Labels',
      type: 'short-input',
      placeholder: 'Comma-separated label IDs (optional)',
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
    },

    {
      id: 'cardId',
      title: 'Card',
      type: 'short-input',
      placeholder: 'Enter card ID or search for a card',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
      required: true,
    },

    {
      id: 'name',
      title: 'New Card Name',
      type: 'short-input',
      placeholder: 'Enter new card name (leave empty to keep current)',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
    },

    {
      id: 'desc',
      title: 'New Description',
      type: 'long-input',
      placeholder: 'Enter new description (leave empty to keep current)',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
    },

    {
      id: 'closed',
      title: 'Archive Card',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
    },

    {
      id: 'dueComplete',
      title: 'Mark Due Date Complete',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
    },

    {
      id: 'idList',
      title: 'Move to List',
      type: 'short-input',
      placeholder: 'Enter list ID to move card',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
    },

    {
      id: 'due',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD or ISO 8601',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
    },

    {
      id: 'boardId',
      title: 'Board ID',
      type: 'short-input',
      placeholder: 'Enter board ID to get board actions',
      condition: {
        field: 'operation',
        value: 'trello_get_actions',
      },
    },
    {
      id: 'cardId',
      title: 'Card ID',
      type: 'short-input',
      placeholder: 'Enter card ID to get card actions',
      condition: {
        field: 'operation',
        value: 'trello_get_actions',
      },
    },
    {
      id: 'filter',
      title: 'Action Filter',
      type: 'short-input',
      placeholder: 'e.g., commentCard,updateCard',
      condition: {
        field: 'operation',
        value: 'trello_get_actions',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: 'trello_get_actions',
      },
    },
    {
      id: 'cardId',
      title: 'Card',
      type: 'short-input',
      placeholder: 'Enter card ID or search for a card',
      condition: {
        field: 'operation',
        value: 'trello_add_comment',
      },
      required: true,
    },

    {
      id: 'text',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Enter your comment',
      condition: {
        field: 'operation',
        value: 'trello_add_comment',
      },
      required: true,
    },
  ],
  tools: {
    access: [
      'trello_list_lists',
      'trello_list_cards',
      'trello_create_card',
      'trello_update_card',
      'trello_get_actions',
      'trello_add_comment',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'trello_list_lists':
            return 'trello_list_lists'
          case 'trello_list_cards':
            return 'trello_list_cards'
          case 'trello_create_card':
            return 'trello_create_card'
          case 'trello_update_card':
            return 'trello_update_card'
          case 'trello_get_actions':
            return 'trello_get_actions'
          case 'trello_add_comment':
            return 'trello_add_comment'
          default:
            return 'trello_list_lists'
        }
      },
      params: (params) => {
        const { operation, limit, closed, dueComplete, ...rest } = params

        const result: Record<string, any> = { ...rest }

        if (limit && operation === 'trello_get_actions') {
          result.limit = Number.parseInt(limit, 10)
        }

        if (closed !== undefined && operation === 'trello_update_card') {
          if (typeof closed === 'string') {
            result.closed = closed.toLowerCase() === 'true' || closed === '1'
          } else if (typeof closed === 'number') {
            result.closed = closed !== 0
          } else {
            result.closed = Boolean(closed)
          }
        }

        if (dueComplete !== undefined && operation === 'trello_update_card') {
          if (typeof dueComplete === 'string') {
            result.dueComplete = dueComplete.toLowerCase() === 'true' || dueComplete === '1'
          } else if (typeof dueComplete === 'number') {
            result.dueComplete = dueComplete !== 0
          } else {
            result.dueComplete = Boolean(dueComplete)
          }
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Trello operation to perform' },
    credential: { type: 'string', description: 'Trello OAuth credential' },
    boardId: { type: 'string', description: 'Board ID' },
    listId: { type: 'string', description: 'List ID' },
    cardId: { type: 'string', description: 'Card ID' },
    name: { type: 'string', description: 'Card name/title' },
    desc: { type: 'string', description: 'Card or board description' },
    pos: { type: 'string', description: 'Card position (top, bottom, or number)' },
    due: { type: 'string', description: 'Due date in ISO 8601 format' },
    labels: { type: 'string', description: 'Comma-separated label IDs' },
    closed: { type: 'boolean', description: 'Archive/close status' },
    idList: { type: 'string', description: 'ID of list to move card to' },
    dueComplete: { type: 'boolean', description: 'Mark due date as complete' },
    filter: { type: 'string', description: 'Action type filter' },
    limit: { type: 'number', description: 'Maximum number of results' },
    text: { type: 'string', description: 'Comment text' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    lists: {
      type: 'array',
      description: 'Array of list objects (for list_lists operation)',
    },
    cards: {
      type: 'array',
      description: 'Array of card objects (for list_cards operation)',
    },
    card: {
      type: 'json',
      description: 'Card object (for create_card and update_card operations)',
    },
    actions: {
      type: 'array',
      description: 'Array of action objects (for get_actions operation)',
    },
    comment: {
      type: 'json',
      description: 'Comment object (for add_comment operation)',
    },
    count: {
      type: 'number',
      description: 'Number of items returned (boards, cards, actions)',
    },
    error: {
      type: 'string',
      description: 'Error message if operation failed',
    },
  },
}
