import { TrelloIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const trelloConnectorMeta: ConnectorMeta = {
  id: 'trello',
  name: 'Trello',
  description: 'Sync board cards, descriptions, checklists, and comments from Trello',
  version: '1.1.0',
  icon: TrelloIcon,

  auth: {
    mode: 'oauth',
    provider: 'trello',
    requiredScopes: ['read'],
  },

  configFields: [
    {
      id: 'boardSelector',
      title: 'Boards',
      type: 'selector',
      selectorKey: 'trello.boards',
      canonicalParamId: 'boardIds',
      mode: 'basic',
      multi: true,
      required: false,
      placeholder: 'Select boards (empty = all open boards)',
      description:
        'Boards to sync. Leave empty to sync cards from every open board you can access.',
    },
    {
      id: 'boardIds',
      title: 'Board IDs',
      type: 'short-input',
      canonicalParamId: 'boardIds',
      mode: 'advanced',
      multi: true,
      required: false,
      placeholder: 'e.g. 5f2b1c8e9a1d2b0011223344 (empty = all open boards)',
      description:
        'Comma-separated board IDs (24-character hex). Leave empty to sync cards from every open board you can access.',
    },
    {
      id: 'cardFilter',
      title: 'Cards',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Open cards only', id: 'open' },
        { label: 'All cards (including archived)', id: 'all' },
      ],
      description: 'Which cards to sync. Defaults to open cards only.',
    },
    {
      id: 'maxCards',
      title: 'Max Cards',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 1000 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'boardName', displayName: 'Board', fieldType: 'text' },
    { id: 'listName', displayName: 'List', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'closed', displayName: 'Archived', fieldType: 'boolean' },
    { id: 'due', displayName: 'Due Date', fieldType: 'date' },
    { id: 'lastActivity', displayName: 'Last Activity', fieldType: 'date' },
  ],
}
