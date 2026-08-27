import { GoogleVaultIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const googleVaultConnectorMeta: ConnectorMeta = {
  id: 'google_vault',
  name: 'Google Vault',
  description: 'Sync Google Vault matters, holds, and saved queries into your knowledge base',
  version: '1.0.0',
  icon: GoogleVaultIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-vault',
    requiredScopes: ['https://www.googleapis.com/auth/ediscovery.readonly'],
  },

  configFields: [
    {
      id: 'matterId',
      title: 'Matter ID',
      type: 'short-input',
      placeholder: 'e.g. 12345678901234567890 (leave blank to sync every matter)',
      required: false,
      description: 'Restrict the sync to a single matter. Leave blank to sync all matters.',
    },
    {
      id: 'matterState',
      title: 'Matter State',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'All states', id: 'ALL' },
        { label: 'Open only', id: 'OPEN' },
        { label: 'Closed only', id: 'CLOSED' },
      ],
    },
    {
      id: 'includeHolds',
      title: 'Include Holds',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'includeSavedQueries',
      title: 'Include Saved Queries',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
    },
    {
      id: 'maxDocuments',
      title: 'Max Documents',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'resourceType', displayName: 'Resource Type', fieldType: 'text' },
    { id: 'matterId', displayName: 'Matter ID', fieldType: 'text' },
    { id: 'state', displayName: 'Matter State', fieldType: 'text' },
    { id: 'corpus', displayName: 'Corpus', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
