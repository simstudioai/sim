import { GmailIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_THREADS = 500

export const gmailConnectorMeta: ConnectorMeta = {
  search: true,
  searchDocsUrl: 'https://docs.sim.ai/search/gmail',
  id: 'gmail',
  name: 'Gmail',
  description: 'Sync email threads from Gmail',
  version: '1.1.0',
  icon: GmailIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-email',
    requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
  },

  permissionScopedListing: { capFieldIds: ['maxThreads'] },
  configFields: [
    {
      id: 'labelSelector',
      title: 'Labels',
      type: 'selector',
      selectorKey: 'gmail.labels',
      hideInMemberMode: true,
      canonicalParamId: 'label',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more labels',
      required: false,
      description: 'Sync threads matching any selected label. Leave empty to use all labels.',
    },
    {
      id: 'label',
      title: 'Labels',
      type: 'short-input',
      canonicalParamId: 'label',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. INBOX, Engineering (comma-separated)',
      required: false,
      description: 'Use label names or system IDs such as INBOX. Leave empty to use all labels.',
    },
    {
      id: 'dateRange',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      placeholder: 'All time (default)',
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
      id: 'excludePromotions',
      setupGroup: 'options',
      title: 'Exclude Promotions',
      type: 'dropdown',
      required: false,
      placeholder: 'Yes (default)',
      options: [
        { label: 'Yes (recommended)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'excludeSocial',
      setupGroup: 'options',
      title: 'Exclude Social',
      type: 'dropdown',
      required: false,
      placeholder: 'Yes (default)',
      options: [
        { label: 'Yes (recommended)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'query',
      setupGroup: 'options',
      title: 'Search Filter',
      type: 'short-input',
      placeholder: 'e.g. from:boss@company.com subject:report has:attachment',
      required: false,
      description: 'Additional Gmail API search filter.',
    },
    {
      id: 'maxThreads',
      setupGroup: 'options',
      title: 'Max Threads',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_THREADS})`,
    },
  ],

  tagDefinitions: [
    { id: 'from', displayName: 'From', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'messageCount', displayName: 'Messages in Thread', fieldType: 'number' },
    { id: 'lastMessageDate', displayName: 'Last Message', fieldType: 'date' },
  ],
}
