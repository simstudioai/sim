import { GoogleSlidesIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const googleSlidesConnectorMeta: ConnectorMeta = {
  id: 'google_slides',
  name: 'Google Slides',
  description: 'Sync Google Slides presentations',
  version: '1.0.0',
  icon: GoogleSlidesIcon,

  /**
   * The Slides API has no dedicated Sim OAuth service. `presentations.get`
   * accepts `https://www.googleapis.com/auth/drive`, which the `google-drive`
   * provider already grants — the same provider every `google_slides` tool uses.
   */
  auth: {
    mode: 'oauth',
    provider: 'google-drive',
    requiredScopes: ['https://www.googleapis.com/auth/drive'],
  },

  permissionScopedListing: { capFieldIds: ['maxDocs'] },
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
      id: 'includeSpeakerNotes',
      title: 'Speaker Notes',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Include speaker notes', id: 'yes' },
        { label: 'Slide text only', id: 'no' },
      ],
    },
    {
      id: 'maxDocs',
      title: 'Max Presentations',
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
