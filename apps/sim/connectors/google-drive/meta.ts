import { GoogleDriveIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/** The config field naming the administrator a service account crawls as. */
export const GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID = 'adminEmail'
/** The config field saying how far open shares are searchable. */
export const GOOGLE_DRIVE_OPEN_SHARING_FIELD_ID = 'openSharing'

export const googleDriveConnectorMeta: ConnectorMeta = {
  id: 'google_drive',
  name: 'Google Drive',
  description: 'Sync documents from Google Drive',
  version: '1.0.0',
  icon: GoogleDriveIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-drive',
    requiredScopes: ['https://www.googleapis.com/auth/drive'],
    /**
     * Read-only, and narrower than the interactive scope above: a crawl under
     * domain-wide delegation reads every file in the domain, so it should never
     * hold write access. The directory scopes are what let group grants be
     * resolved to the people in them.
     */
    serviceAccountScopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/admin.directory.group.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly',
    ],
    serviceAccountSubjectFieldId: GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID,
  },

  /** `files.list` under a member's token returns only what that member can open. */
  permissionScopedListing: { capFieldIds: ['maxFiles'] },

  /** `files.list` reports each file's own permissions, so one crawl can mirror them. */
  mirrorsSourceAcls: true,

  configFields: [
    {
      id: GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID,
      title: 'Crawl as',
      type: 'short-input',
      required: false,
      placeholder: 'admin@yourcompany.com',
      description:
        'A Google Workspace administrator the service account acts as. Required to mirror Drive permissions; leave blank when syncing with your own Google account.',
    },
    {
      id: GOOGLE_DRIVE_OPEN_SHARING_FIELD_ID,
      title: 'Openly shared files',
      type: 'dropdown',
      required: false,
      description:
        'Files shared beyond named people and groups. Kept out of search by default, because a domain-wide or public share is more often an accident than an intention. Never applies to link-only shares, which stay unsearchable.',
      options: [
        { label: 'Keep out of search', id: 'none' },
        { label: 'Anyone in the domain can find', id: 'domain' },
        { label: 'Anyone can find', id: 'anyone' },
      ],
    },
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
      id: 'fileType',
      title: 'File Type',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'All supported files', id: 'all' },
        { label: 'Google Docs only', id: 'documents' },
        { label: 'Google Sheets only', id: 'spreadsheets' },
        { label: 'Google Slides only', id: 'presentations' },
        { label: 'Plain text files only', id: 'text' },
      ],
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
    { id: 'owners', displayName: 'Owner', fieldType: 'text' },
    { id: 'fileType', displayName: 'File Type', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'starred', displayName: 'Starred', fieldType: 'boolean' },
  ],
}
