import { ObsidianIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const obsidianConnectorMeta: ConnectorMeta = {
  id: 'obsidian',
  name: 'Obsidian',
  description: 'Sync notes from an Obsidian vault via the Local REST API plugin',
  version: '1.0.0',
  icon: ObsidianIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Obsidian Local REST API key',
  },

  configFields: [
    {
      id: 'vaultUrl',
      title: 'Vault URL',
      type: 'short-input',
      placeholder: 'https://127.0.0.1:27124',
      required: true,
      description: 'Base URL of your Obsidian Local REST API (default port: 27124 for HTTPS)',
    },
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'e.g. Projects/Notes',
      required: false,
      description: 'Only sync notes from this folder (leave empty for entire vault)',
    },
  ],

  tagDefinitions: [
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'folder', displayName: 'Folder', fieldType: 'text' },
    { id: 'modifiedAt', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
  ],
}
