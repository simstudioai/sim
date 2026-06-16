import { TypeformIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const typeformConnectorMeta: ConnectorMeta = {
  id: 'typeform',
  name: 'Typeform',
  description: 'Sync form responses from Typeform into your knowledge base',
  version: '1.0.0',
  icon: TypeformIcon,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'Enter your Typeform personal access token',
  },

  /**
   * Incremental sync narrows the listing to responses submitted after the last
   * sync via the `since` filter (inclusive, matched against `submitted_at` for
   * completed responses). Responses are immutable, so reconciliation by content
   * hash skips anything already indexed.
   */
  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      placeholder: 'e.g. abc123XYZ',
      required: true,
      description: 'The Typeform form whose responses you want to sync',
    },
    {
      id: 'responseType',
      title: 'Responses',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Completed only', id: 'completed' },
        { label: 'Partial & completed', id: 'partial' },
        { label: 'All (including started)', id: 'all' },
      ],
      description: 'Which responses to sync by completion status. Defaults to completed only.',
    },
    {
      id: 'since',
      title: 'Submitted After',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      description: 'Only sync responses submitted on or after this date (ISO 8601, UTC).',
    },
    {
      id: 'until',
      title: 'Submitted Before',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-12-31T23:59:59Z',
      description: 'Only sync responses submitted on or before this date (ISO 8601, UTC).',
    },
    {
      id: 'query',
      title: 'Search Filter',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. acme',
      description:
        'Only sync responses containing this text in any answer, hidden field, or variable.',
    },
    {
      id: 'maxResponses',
      title: 'Max Responses',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'formTitle', displayName: 'Form Title', fieldType: 'text' },
    { id: 'platform', displayName: 'Platform', fieldType: 'text' },
    { id: 'submittedAt', displayName: 'Submitted At', fieldType: 'date' },
  ],
}
