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
      id: 'folderSelector',
      title: 'Folders',
      type: 'selector',
      selectorKey: 'google.drive',
      mimeType: 'application/vnd.google-apps.folder',
      canonicalParamId: 'folderId',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more folders (optional)',
      required: false,
    },
    {
      id: 'folderId',
      title: 'Folder IDs',
      type: 'short-input',
      canonicalParamId: 'folderId',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. 1aBcDeFg…, 2cDeFgHi… (comma-separated for multiple)',
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
