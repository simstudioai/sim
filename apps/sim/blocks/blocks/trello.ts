import { TrelloIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { TrelloResponse } from '@/tools/trello'

function getTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .flatMap((item) => (typeof item === 'string' ? [item.trim()] : []))
      .filter((item) => item.length > 0)

    return items.length > 0 ? items : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      return parseStringArray(parsed)
    } catch {
      return undefined
    }
  }

  const items = trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : undefined
}

/**
 * Trello uses a custom token flow and non-UUID credential IDs, so the block keeps
 * the normal OAuth block UX while relying on the custom Trello auth routes.
 */
export const TrelloBlock: BlockConfig<TrelloResponse> = {
  type: 'trello',
  name: 'Trello',
  description: 'Manage Trello lists, cards, and activity',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with Trello to list board lists, list cards, create cards, update cards, review activity, and add comments.',
  docsLink: 'https://docs.sim.ai/tools/trello',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  tags: ['project-management', 'ticketing'],
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
      serviceId: 'trello',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      requiredScopes: getScopesForService('trello'),
      placeholder: 'Select Trello account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Trello Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'boardSelector',
      title: 'Board',
      type: 'project-selector',
      canonicalParamId: 'boardId',
      serviceId: 'trello',
      selectorKey: 'trello.boards',
      placeholder: 'Select Trello board',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['trello_list_lists', 'trello_list_cards', 'trello_get_actions'],
      },
      required: {
        field: 'operation',
        value: 'trello_list_lists',
      },
    },
    {
      id: 'manualBoardId',
      title: 'Board ID',
      type: 'short-input',
      canonicalParamId: 'boardId',
      placeholder: 'Enter Trello board ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['trello_list_lists', 'trello_list_cards', 'trello_get_actions'],
      },
      required: {
        field: 'operation',
        value: 'trello_list_lists',
      },
    },
    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: 'Enter Trello list ID',
      condition: {
        field: 'operation',
        value: ['trello_list_cards', 'trello_create_card'],
      },
      required: {
        field: 'operation',
        value: 'trello_create_card',
      },
    },
    {
      id: 'cardId',
      title: 'Card ID',
      type: 'short-input',
      placeholder: 'Enter Trello card ID',
      condition: {
        field: 'operation',
        value: ['trello_update_card', 'trello_get_actions', 'trello_add_comment'],
      },
      required: {
        field: 'operation',
        value: ['trello_update_card', 'trello_add_comment'],
      },
    },
    {
      id: 'name',
      title: 'Card Name',
      type: 'short-input',
      placeholder: 'Enter card name',
      condition: {
        field: 'operation',
        value: ['trello_create_card', 'trello_update_card'],
      },
      required: {
        field: 'operation',
        value: 'trello_create_card',
      },
    },
    {
      id: 'desc',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter card description',
      condition: {
        field: 'operation',
        value: ['trello_create_card', 'trello_update_card'],
      },
    },
    {
      id: 'pos',
      title: 'Position',
      type: 'short-input',
      placeholder: 'top, bottom, or a positive float',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
    },
    {
      id: 'due',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD or ISO 8601 timestamp',
      condition: {
        field: 'operation',
        value: ['trello_create_card', 'trello_update_card'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date or timestamp based on the user's description.
The timestamp should be in ISO 8601 format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ.
Examples:
- "tomorrow" -> Calculate tomorrow's date in YYYY-MM-DD format
- "next Friday" -> Calculate the next Friday in YYYY-MM-DD format
- "in 3 days" -> Calculate 3 days from now in YYYY-MM-DD format
- "end of month" -> Calculate the last day of the current month
- "next week at 3pm" -> Calculate next week's date at 15:00:00Z

Return ONLY the date/timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the due date (e.g. "next Friday", "in 2 weeks")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'dueComplete',
      title: 'Due Status',
      type: 'dropdown',
      options: [
        { label: 'Leave Unset', id: '' },
        { label: 'Complete', id: 'true' },
        { label: 'Incomplete', id: 'false' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['trello_create_card', 'trello_update_card'],
      },
    },
    {
      id: 'labelIds',
      title: 'Label IDs',
      type: 'short-input',
      placeholder: 'Comma-separated label IDs',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'trello_create_card',
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of Trello label IDs. Return ONLY the comma-separated values - no explanations, no extra text.',
        placeholder: 'Describe the label IDs to include...',
      },
    },
    {
      id: 'closed',
      title: 'Archive Status',
      type: 'dropdown',
      options: [
        { label: 'Leave Unchanged', id: '' },
        { label: 'Archive Card', id: 'true' },
        { label: 'Reopen Card', id: 'false' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
    },
    {
      id: 'idList',
      title: 'Move to List ID',
      type: 'short-input',
      placeholder: 'Enter Trello list ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'trello_update_card',
      },
    },
    {
      id: 'filter',
      title: 'Action Filter',
      type: 'short-input',
      placeholder: 'commentCard,updateCard,createCard or all',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'trello_get_actions',
      },
    },
    {
      id: 'limit',
      title: 'Board Action Limit',
      type: 'short-input',
      placeholder: 'Maximum number of board actions',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'trello_get_actions',
      },
    },
    {
      id: 'page',
      title: 'Action Page',
      type: 'short-input',
      placeholder: 'Page number for board or card actions',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'trello_get_actions',
      },
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
      tool: (params) => getTrimmedString(params.operation) ?? 'trello_list_lists',
      params: (params) => {
        const operation = getTrimmedString(params.operation) ?? 'trello_list_lists'
        const baseParams: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
        }

        switch (operation) {
          case 'trello_list_lists': {
            const boardId = getTrimmedString(params.boardId)

            if (!boardId) {
              throw new Error('Board ID is required.')
            }

            return {
              ...baseParams,
              boardId,
            }
          }

          case 'trello_list_cards': {
            const boardId = getTrimmedString(params.boardId)
            const listId = getTrimmedString(params.listId)

            if (boardId && listId) {
              throw new Error('Provide either a board ID or list ID, not both.')
            }

            if (!boardId && !listId) {
              throw new Error('Provide either a board ID or list ID.')
            }

            return {
              ...baseParams,
              boardId,
              listId,
            }
          }

          case 'trello_create_card': {
            const listId = getTrimmedString(params.listId)
            const name = getTrimmedString(params.name)

            if (!listId) {
              throw new Error('List ID is required.')
            }

            if (!name) {
              throw new Error('Card name is required.')
            }

            return {
              ...baseParams,
              listId,
              name,
              desc: getTrimmedString(params.desc),
              pos: getTrimmedString(params.pos),
              due: getTrimmedString(params.due),
              dueComplete: parseOptionalBooleanInput(params.dueComplete),
              labelIds: parseStringArray(params.labelIds),
            }
          }

          case 'trello_update_card': {
            const cardId = getTrimmedString(params.cardId)

            if (!cardId) {
              throw new Error('Card ID is required.')
            }

            return {
              ...baseParams,
              cardId,
              name: getTrimmedString(params.name),
              desc: getTrimmedString(params.desc),
              closed: parseOptionalBooleanInput(params.closed),
              idList: getTrimmedString(params.idList),
              due: getTrimmedString(params.due),
              dueComplete: parseOptionalBooleanInput(params.dueComplete),
            }
          }

          case 'trello_get_actions': {
            const boardId = getTrimmedString(params.boardId)
            const cardId = getTrimmedString(params.cardId)

            if (boardId && cardId) {
              throw new Error('Provide either a board ID or card ID, not both.')
            }

            if (!boardId && !cardId) {
              throw new Error('Provide either a board ID or card ID.')
            }

            return {
              ...baseParams,
              boardId,
              cardId,
              filter: getTrimmedString(params.filter),
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: parseOptionalNumberInput(params.page, 'page'),
            }
          }

          case 'trello_add_comment': {
            const cardId = getTrimmedString(params.cardId)
            const text = getTrimmedString(params.text)

            if (!cardId) {
              throw new Error('Card ID is required.')
            }

            if (!text) {
              throw new Error('Comment text is required.')
            }

            return {
              ...baseParams,
              cardId,
              text,
            }
          }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Trello operation to perform' },
    oauthCredential: { type: 'string', description: 'Trello OAuth credential' },
    boardId: { type: 'string', description: 'Trello board ID' },
    listId: { type: 'string', description: 'Trello list ID' },
    cardId: { type: 'string', description: 'Trello card ID' },
    name: { type: 'string', description: 'Card name' },
    desc: { type: 'string', description: 'Card description' },
    pos: { type: 'string', description: 'Card position (top, bottom, or positive float)' },
    due: { type: 'string', description: 'Due date in ISO 8601 format' },
    dueComplete: { type: 'boolean', description: 'Whether the due date is complete' },
    labelIds: {
      type: 'json',
      description: 'Label IDs as an array or comma-separated string',
    },
    closed: { type: 'boolean', description: 'Whether the card should be archived or reopened' },
    idList: { type: 'string', description: 'List ID to move the card to' },
    filter: { type: 'string', description: 'Trello action filter' },
    limit: { type: 'number', description: 'Maximum number of board actions to return' },
    page: { type: 'number', description: 'Page number for action results' },
    text: { type: 'string', description: 'Comment text' },
  },
  outputs: {
    lists: {
      type: 'json',
      description: 'Board lists (id, name, closed, pos, idBoard)',
    },
    cards: {
      type: 'json',
      description:
        'Cards (id, name, desc, url, idBoard, idList, closed, labelIds, labels, due, dueComplete)',
    },
    card: {
      type: 'json',
      description:
        'Created or updated card (id, name, desc, url, idBoard, idList, closed, labelIds, labels, due, dueComplete)',
    },
    actions: {
      type: 'json',
      description:
        'Actions (id, type, date, idMemberCreator, text, memberCreator, card, board, list)',
    },
    comment: {
      type: 'json',
      description:
        'Created comment action (id, type, date, idMemberCreator, text, memberCreator, card, board, list)',
    },
    count: {
      type: 'number',
      description: 'Number of returned lists, cards, or actions',
    },
    error: {
      type: 'string',
      description: 'Error message when the Trello operation fails',
    },
  },
}
