import { GoogleDocsIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const googleDocsConnectorMeta: ConnectorMeta = {
  id: 'google_docs',
  name: 'Google Docs',
  description: 'Sync Google Docs documents',
  version: '1.0.0',
  icon: GoogleDocsIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-docs',
    requiredScopes: ['https://www.googleapis.com/auth/drive'],
  },

  configFields: [
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'e.g. 1aBcDeFgHiJkLmNoPqRsTuVwXyZ (optional)',
      required: false,
    },
    {
      id: 'maxDocs',
      title: 'Max Documents',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'owners', displayName: 'Owner', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
