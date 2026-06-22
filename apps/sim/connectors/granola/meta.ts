import { GranolaIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const granolaConnectorMeta: ConnectorMeta = {
  id: 'granola',
  name: 'Granola',
  description: 'Sync AI meeting notes and summaries from Granola',
  version: '1.0.0',
  icon: GranolaIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Granola API key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'maxNotes',
      title: 'Max Notes',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
      description: 'Cap the number of notes synced. Leave blank to sync all notes.',
    },
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. fol_4y6LduVdwSKC27',
      description:
        'Scope the sync to a single folder and its child folders. Leave blank to sync notes from all folders.',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2025-01-01 or 2025-01-01T00:00:00Z',
      description:
        'Only sync notes created on or after this date (ISO 8601). Leave blank to sync notes regardless of creation date.',
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2025-12-31 or 2025-12-31T23:59:59Z',
      description:
        'Only sync notes created on or before this date (ISO 8601). Leave blank to sync notes regardless of creation date.',
    },
  ],

  tagDefinitions: [
    { id: 'title', displayName: 'Title', fieldType: 'text' },
    { id: 'owner', displayName: 'Owner', fieldType: 'text' },
    { id: 'attendees', displayName: 'Attendees', fieldType: 'text' },
    { id: 'folders', displayName: 'Folders', fieldType: 'text' },
    { id: 'meeting', displayName: 'Meeting', fieldType: 'text' },
    { id: 'noteDate', displayName: 'Note Date', fieldType: 'date' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],
}
