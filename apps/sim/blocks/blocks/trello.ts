import { TrelloIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { TrelloBlockDisplay } from '@/blocks/blocks/trello.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
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
  ...TrelloBlockDisplay,
  authMode: AuthMode.OAuth,
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
      dependsOn: ['credential'],
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

export const TrelloBlockMeta = {
  tags: ['project-management', 'ticketing'],
  url: 'https://trello.com',
  templates: [
    {
      icon: TrelloIcon,
      title: 'Trello card auto-router',
      prompt:
        'Build a scheduled workflow that polls a Trello inbox list, classifies each new card by topic, and moves it to the right list based on the classification.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello + Linear bridge',
      prompt:
        'Create a workflow that mirrors Trello cards in a chosen list into Linear issues, keeps status and comments in sync, and writes the link back to the Trello card.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello SLA monitor',
      prompt:
        'Build a workflow that watches Trello cards for due-date breaches, sends reminders, and escalates to managers via Slack when items slip more than 2 days.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello content pipeline',
      prompt:
        'Create a workflow that reads a Trello editorial board, publishes the cards in the "ready" list to WordPress on schedule, and moves the card to "live" with the URL attached.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello weekly digest',
      prompt:
        'Build a scheduled weekly workflow that summarizes Trello board movements — cards completed, blocked, in-progress — and emails the digest to the project owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello stale-card sweeper',
      prompt:
        'Create a scheduled workflow that scans a Trello board for cards with no activity in 30 days, comments a nudge on each, and posts a stale-card list to Slack for the project owner.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TrelloIcon,
      title: 'Trello onboarding seeder',
      prompt:
        'Build a workflow that creates the standard onboarding cards in a Trello list for each new hire, sets due dates by step, and tailors the card set to their role.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
    },
  ],
  skills: [
    {
      name: 'create-card',
      description: 'Create a Trello card in a list with a description, due date, and labels.',
      content:
        '# Create a Trello Card\n\nAdd a new card to a list so work is captured on the right board.\n\n## Steps\n1. Use the Create Card operation and select your Trello account.\n2. Provide the List ID where the card should land and the Card Name.\n3. Add an optional Description, a Due Date (natural language like "next Friday" works), and Label IDs.\n4. Set Position to top or bottom to control where the card appears in the list.\n\n## Output\nReturn the created card including its id, url, and list, so it can be linked or updated later.',
    },
    {
      name: 'triage-and-move-cards',
      description:
        'List cards on a board or list, classify them, and move each to the correct list.',
      content:
        '# Triage and Route Trello Cards\n\nRead incoming cards, decide where each belongs, and route them automatically.\n\n## Steps\n1. Use Get Lists with the Board ID to learn the available lists and their IDs.\n2. Use List Cards with the board or list ID to pull the cards needing triage.\n3. Classify each card by its name and description (topic, priority, owner).\n4. Use Update Card with the Move to List ID to route each card to its destination list.\n\n## Output\nReturn a summary of how many cards were moved and the destination list for each.',
    },
    {
      name: 'comment-on-card',
      description: 'Add a comment to a Trello card to leave a note, nudge, or status update.',
      content:
        '# Comment on a Trello Card\n\nLeave a comment on a card to record context or nudge an owner.\n\n## Steps\n1. Use the Add Comment operation and select your Trello account.\n2. Provide the Card ID of the target card.\n3. Write the Comment text, including any links or mentions the team needs.\n\n## Output\nReturn the created comment action with its id and date so the note can be referenced.',
    },
    {
      name: 'review-card-activity',
      description: 'Pull the recent action history for a Trello board or card and summarize it.',
      content:
        '# Review Trello Card Activity\n\nInspect what has happened recently on a board or card to build a digest or audit.\n\n## Steps\n1. Use the Get Actions operation with either a Board ID or a Card ID (one or the other, not both).\n2. Set an Action Filter such as commentCard,updateCard,createCard to focus on the events you care about.\n3. Use Board Action Limit and Action Page to page through longer histories.\n\n## Output\nReturn the actions with their type, date, author, and text, summarized into a short activity recap.',
    },
  ],
} as const satisfies BlockMeta
