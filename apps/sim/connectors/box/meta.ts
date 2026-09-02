import { BoxCompanyIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const boxConnectorMeta: ConnectorMeta = {
  id: 'box',
  name: 'Box',
  description: 'Sync text-extractable files from Box',
  version: '1.0.0',
  icon: BoxCompanyIcon,

  auth: {
    mode: 'oauth',
    provider: 'box',
    requiredScopes: ['root_readwrite'],
  },

  permissionScopedListing: { capFieldIds: ['maxFiles'] },
  configFields: [
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'e.g. 123456789 (default: entire account)',
      required: false,
      description:
        'Numeric Box folder ID to sync recursively. Leave empty (or use 0) to sync all files.',
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
    { id: 'extension', displayName: 'Extension', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'fileSize', displayName: 'File Size (bytes)', fieldType: 'number' },
  ],
}
