import { MondayIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const mondayConnectorMeta: ConnectorMeta = {
  id: 'monday',
  name: 'Monday.com',
  description: 'Sync board items and updates from Monday.com into your knowledge base',
  version: '1.0.0',
  icon: MondayIcon,

  auth: {
    mode: 'oauth',
    provider: 'monday',
    requiredScopes: ['boards:read', 'updates:read', 'me:read'],
  },

  configFields: [
    {
      id: 'boardSelector',
      title: 'Boards',
      type: 'selector',
      selectorKey: 'monday.boards',
      canonicalParamId: 'boardIds',
      mode: 'basic',
      multi: true,
      required: false,
      placeholder: 'Select boards (empty = all active boards)',
      description:
        'Boards to sync. Leave empty to sync items from every active board you can access.',
    },
    {
      id: 'boardIds',
      title: 'Board IDs',
      type: 'short-input',
      canonicalParamId: 'boardIds',
      mode: 'advanced',
      multi: true,
      required: false,
      placeholder: 'e.g. 1234567890, 9876543210 (empty = all active boards)',
      description:
        'Comma-separated board IDs to sync — find a board ID in its URL (.../boards/<id>). Leave empty to sync items from every active board you can access.',
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'boardName', displayName: 'Board', fieldType: 'text' },
    { id: 'groupTitle', displayName: 'Group', fieldType: 'text' },
    { id: 'itemName', displayName: 'Item', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'creatorName', displayName: 'Creator', fieldType: 'text' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
  ],
}
