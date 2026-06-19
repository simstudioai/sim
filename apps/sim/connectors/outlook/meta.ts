import { OutlookIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_CONVERSATIONS = 500

export const outlookConnectorMeta: ConnectorMeta = {
  id: 'outlook',
  name: 'Outlook',
  description: 'Sync email conversations from Outlook',
  version: '1.0.0',
  icon: OutlookIcon,

  auth: {
    mode: 'oauth',
    provider: 'outlook',
    requiredScopes: ['Mail.Read'],
  },

  configFields: [
    {
      id: 'folderSelector',
      title: 'Folder',
      type: 'selector',
      selectorKey: 'outlook.folders',
      canonicalParamId: 'folder',
      mode: 'basic',
      placeholder: 'Select a folder',
      required: false,
    },
    {
      id: 'folder',
      title: 'Folder',
      type: 'dropdown',
      canonicalParamId: 'folder',
      mode: 'advanced',
      required: false,
      options: [
        { label: 'Inbox', id: 'inbox' },
        { label: 'All Mail', id: 'all' },
        { label: 'Sent Items', id: 'sentitems' },
        { label: 'Archive', id: 'archive' },
      ],
    },
    {
      id: 'dateRange',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 7 days', id: '7d' },
        { label: 'Last 30 days', id: '30d' },
        { label: 'Last 90 days', id: '90d' },
        { label: 'Last 6 months', id: '6m' },
        { label: 'Last year', id: '1y' },
        { label: 'All time', id: 'all' },
      ],
    },
    {
      id: 'focusedOnly',
      title: 'Focused Inbox Only',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes (recommended)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'query',
      title: 'Search Filter',
      type: 'short-input',
      placeholder: 'e.g. from:boss@company.com subject:report hasAttachment:true',
      required: false,
      description: 'Search filter using Outlook KQL syntax.',
    },
    {
      id: 'maxConversations',
      title: 'Max Conversations',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_CONVERSATIONS})`,
    },
  ],

  tagDefinitions: [
    { id: 'from', displayName: 'From', fieldType: 'text' },
    { id: 'categories', displayName: 'Categories', fieldType: 'text' },
    { id: 'importance', displayName: 'Importance', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Messages in Conversation', fieldType: 'number' },
    { id: 'lastMessageDate', displayName: 'Last Message', fieldType: 'date' },
  ],
}
