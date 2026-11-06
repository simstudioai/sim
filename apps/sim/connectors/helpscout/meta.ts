import { HelpScoutIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/** Default ceiling on conversations pulled per sync when Max Conversations is blank. */
export const DEFAULT_MAX_CONVERSATIONS = 500

export const helpScoutConnectorMeta: ConnectorMeta = {
  id: 'helpscout',
  name: 'Help Scout',
  description: 'Sync Help Scout conversations and their threads into your knowledge base',
  version: '1.0.0',
  icon: HelpScoutIcon,

  auth: {
    mode: 'oauth',
    provider: 'helpscout',
    requiredScopes: [],
  },

  configFields: [
    {
      id: 'mailboxSelector',
      title: 'Inbox',
      type: 'selector',
      selectorKey: 'helpscout.mailboxes',
      canonicalParamId: 'mailboxId',
      mode: 'basic',
      placeholder: 'All inboxes',
      required: false,
      preserveValueOnModeChange: true,
      description: 'Inbox to sync conversations from; leave empty to sync every inbox',
    },
    {
      id: 'mailboxId',
      title: 'Inbox ID',
      type: 'short-input',
      canonicalParamId: 'mailboxId',
      mode: 'advanced',
      placeholder: 'e.g. 123456 (default: all inboxes)',
      required: false,
      preserveValueOnModeChange: true,
      description: 'Help Scout inbox ID',
    },
    {
      id: 'status',
      title: 'Conversation Status',
      type: 'dropdown',
      required: false,
      description: 'Which conversations to sync',
      options: [
        { label: 'All statuses (except spam)', id: 'all' },
        { label: 'Active', id: 'active' },
        { label: 'Pending', id: 'pending' },
        { label: 'Closed', id: 'closed' },
      ],
    },
    {
      id: 'includeNotes',
      title: 'Internal Notes',
      type: 'dropdown',
      required: false,
      description: 'Whether internal notes are indexed alongside customer and agent messages',
      options: [
        { label: 'Include notes', id: 'include' },
        { label: 'Exclude notes', id: 'exclude' },
      ],
    },
    {
      id: 'tag',
      title: 'Tag Filter',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. billing, vip (default: all tags)',
      description: 'Only sync conversations with these comma-separated tags',
    },
    {
      id: 'maxConversations',
      title: 'Max Conversations',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_CONVERSATIONS})`,
      description:
        'Maximum number of conversations to sync, newest first. Conversations deleted in Help Scout are not removed from the knowledge base automatically.',
    },
  ],

  tagDefinitions: [
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'customerEmail', displayName: 'Customer Email', fieldType: 'text' },
    { id: 'assignee', displayName: 'Assignee', fieldType: 'text' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
    { id: 'threadCount', displayName: 'Thread Count', fieldType: 'number' },
  ],
}
