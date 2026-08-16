import { IntercomIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_ITEMS = 500

/**
 * Intercom serves regionally-hosted workspaces from dedicated hosts. A token
 * issued for an EU or AU workspace is only guaranteed to resolve against its own
 * regional host, so the region is part of the connector's configuration.
 *
 * @see https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis
 */
export const INTERCOM_API_BASE_BY_REGION = {
  us: 'https://api.intercom.io',
  eu: 'https://api.eu.intercom.io',
  au: 'https://api.au.intercom.io',
} as const

export type IntercomRegion = keyof typeof INTERCOM_API_BASE_BY_REGION

export const DEFAULT_INTERCOM_REGION: IntercomRegion = 'us'

export const intercomConnectorMeta: ConnectorMeta = {
  id: 'intercom',
  name: 'Intercom',
  description: 'Sync Help Center articles and conversations from Intercom',
  version: '1.1.0',
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
      id: 'region',
      title: 'Data Region',
      type: 'dropdown',
      required: false,
      description: 'Regional data hosting for your Intercom workspace (default: US)',
      options: [
        { label: 'US (api.intercom.io)', id: 'us' },
        { label: 'Europe (api.eu.intercom.io)', id: 'eu' },
        { label: 'Australia (api.au.intercom.io)', id: 'au' },
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
        { label: 'Snoozed', id: 'snoozed' },
        { label: 'All', id: 'all' },
      ],
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_ITEMS})`,
      description: 'Maximum total number of articles and conversations to sync',
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
