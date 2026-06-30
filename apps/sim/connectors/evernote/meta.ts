import { EvernoteIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const evernoteConnectorMeta: ConnectorMeta = {
  id: 'evernote',
  name: 'Evernote',
  description: 'Sync notes from Evernote',
  version: '1.0.0',
  icon: EvernoteIcon,

  auth: {
    mode: 'apiKey',
    label: 'Developer Token',
    placeholder: 'Enter your Evernote developer token (starts with S=)',
  },

  configFields: [
    {
      id: 'notebookGuid',
      title: 'Notebook GUID',
      type: 'short-input',
      placeholder: 'Leave empty to sync all notebooks',
      required: false,
      description: 'Sync only notes from this notebook (optional)',
    },
  ],

  tagDefinitions: [
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'notebook', displayName: 'Notebook', fieldType: 'text' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
  ],
}
