import { DropboxIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const dropboxConnectorMeta: ConnectorMeta = {
  id: 'dropbox',
  name: 'Dropbox',
  description: 'Sync text files from Dropbox',
  version: '1.0.0',
  icon: DropboxIcon,

  auth: {
    mode: 'oauth',
    provider: 'dropbox',
    requiredScopes: ['files.metadata.read', 'files.content.read'],
  },

  configFields: [
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'e.g. /Documents (default: entire Dropbox)',
      required: false,
      description: 'Leave empty to sync all supported files',
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'fileSize', displayName: 'File Size (bytes)', fieldType: 'number' },
  ],
}
