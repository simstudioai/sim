import { DocuSignIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const docusignConnectorMeta: ConnectorMeta = {
  id: 'docusign',
  name: 'DocuSign',
  description: 'Sync envelope and agreement metadata from DocuSign into your knowledge base',
  version: '1.0.0',
  icon: DocuSignIcon,

  auth: {
    mode: 'oauth',
    provider: 'docusign',
    requiredScopes: ['signature'],
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'lookback',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 30 days', id: '30' },
        { label: 'Last 90 days (recommended)', id: '90' },
        { label: 'Last 6 months', id: '180' },
      ],
      description:
        'On initial sync only. Filters envelopes by when their status last changed (from_date).',
    },
    {
      id: 'status',
      title: 'Filter by Status',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. completed (or completed,sent)',
      description:
        'Only sync envelopes with these statuses (comma-separated: created, sent, delivered, completed, declined, voided). Leave blank to sync all.',
    },
    {
      id: 'maxEnvelopes',
      title: 'Max Envelopes',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
  ],

  /**
   * Tag definitions are constrained by the document table's slot pools: 7 text slots but
   * only 2 date slots (`date1`, `date2`). The two highest-value envelope dates — when it was
   * sent and when it completed — claim both date slots. `createdDateTime` is intentionally
   * NOT exposed as a date tag: it nearly always equals `sentDateTime` for sent envelopes, so
   * adding it would consume a (non-existent) third date slot and be silently dropped by the
   * slot allocator. `emailSubject` is exposed as a filterable text tag (distinct from the
   * document title) since text slots are plentiful.
   */
  tagDefinitions: [
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'sender', displayName: 'Sender', fieldType: 'text' },
    { id: 'subject', displayName: 'Subject', fieldType: 'text' },
    { id: 'sentDate', displayName: 'Sent Date', fieldType: 'date' },
    { id: 'completedDate', displayName: 'Completed Date', fieldType: 'date' },
  ],
}
