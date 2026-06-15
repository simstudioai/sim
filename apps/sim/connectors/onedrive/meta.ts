import { MicrosoftOneDriveIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const onedriveConnectorMeta: ConnectorMeta = {
  id: 'onedrive',
  name: 'OneDrive',
  description: 'Sync documents from Microsoft OneDrive',
  version: '1.0.0',
  icon: MicrosoftOneDriveIcon,

  auth: { mode: 'oauth', provider: 'onedrive', requiredScopes: ['Files.Read'] },

  configFields: [
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'e.g. Documents/Reports (optional, default: root)',
      required: false,
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],
}
