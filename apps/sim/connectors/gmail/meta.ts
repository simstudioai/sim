import { GmailIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const DEFAULT_MAX_THREADS = 500

export const gmailConnectorMeta: ConnectorMeta = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Sync email threads from Gmail',
  version: '1.0.0',
  icon: GmailIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-email',
    requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
  },

  configFields: [
    {
      id: 'labelSelector',
      title: 'Labels',
      type: 'selector',
      selectorKey: 'gmail.labels',
      canonicalParamId: 'label',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more labels',
      required: false,
      description: 'Only sync emails matching any of these labels. Leave empty for all mail.',
    },
    {
      id: 'label',
      title: 'Labels',
      type: 'short-input',
      canonicalParamId: 'label',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. INBOX, IMPORTANT (comma-separated; commas in label names not supported)',
      required: false,
      description: 'Only sync emails matching any of these labels. Leave empty for all mail.',
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
      id: 'excludePromotions',
      title: 'Exclude Promotions',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes (recommended)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'excludeSocial',
      title: 'Exclude Social',
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
      placeholder: 'e.g. from:boss@company.com subject:report has:attachment',
      required: false,
      description: 'Additional Gmail search filter. Uses the same syntax as the Gmail search bar.',
    },
    {
      id: 'maxThreads',
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
