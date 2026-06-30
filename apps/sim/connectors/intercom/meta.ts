import { IntercomIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_ITEMS = 500

export const intercomConnectorMeta: ConnectorMeta = {
  id: 'intercom',
  name: 'Intercom',
  description: 'Sync Help Center articles and conversations from Intercom',
  version: '1.0.0',
  icon: IntercomIcon,

  auth: {
    mode: 'apiKey',
    label: 'Access Token',
    placeholder: 'Enter your Intercom access token',
  },

  configFields: [
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: true,
      description: 'Choose what to sync from Intercom',
      options: [
        { label: 'Articles Only', id: 'articles' },
        { label: 'Conversations Only', id: 'conversations' },
        { label: 'Articles & Conversations', id: 'both' },
      ],
    },
    {
      id: 'articleState',
      title: 'Article State',
      type: 'dropdown',
      required: false,
      description: 'Filter articles by state (default: published)',
      options: [
        { label: 'Published', id: 'published' },
        { label: 'Draft', id: 'draft' },
        { label: 'All', id: 'all' },
      ],
    },
    {
      id: 'conversationState',
      title: 'Conversation State',
      type: 'dropdown',
      required: false,
      description: 'Filter conversations by state (default: all)',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
        { label: 'All', id: 'all' },
      ],
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_ITEMS})`,
      description: 'Maximum number of articles or conversations to sync',
    },
  ],

  tagDefinitions: [
    { id: 'type', displayName: 'Content Type', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'authorId', displayName: 'Author ID', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Message Count', fieldType: 'number' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
  ],
}
