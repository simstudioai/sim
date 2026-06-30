import { MicrosoftSharepointIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const sharepointConnectorMeta: ConnectorMeta = {
  id: 'sharepoint',
  name: 'SharePoint',
  description: 'Sync documents from a SharePoint site',
  version: '1.0.0',
  icon: MicrosoftSharepointIcon,

  auth: { mode: 'oauth', provider: 'sharepoint', requiredScopes: ['Sites.Read.All'] },

  configFields: [
    {
      id: 'siteUrl',
      title: 'Site URL',
      type: 'short-input',
      placeholder: 'e.g. contoso.sharepoint.com/sites/mysite',
      required: true,
    },
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'e.g. Documents/Reports (optional, defaults to root)',
      required: false,
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      placeholder: 'e.g. 500 (default: unlimited)',
      required: false,
    },
  ],

  tagDefinitions: [
    { id: 'path', displayName: 'Path', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'fileSize', displayName: 'File Size', fieldType: 'number' },
    { id: 'createdBy', displayName: 'Created By', fieldType: 'text' },
    { id: 'siteName', displayName: 'Site Name', fieldType: 'text' },
  ],
}
