import { GoogleDriveIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/** Directory administrator for company-wide indexing; delegated identity for member content. */
export const GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID = 'adminEmail'
/** The config field saying how far open shares are searchable. */
export const GOOGLE_DRIVE_OPEN_SHARING_FIELD_ID = 'openSharing'

export const googleDriveConnectorMeta: ConnectorMeta = {
  search: true,
  searchDocsUrl: 'https://docs.sim.ai/search/google-drive',
  id: 'google_drive',
  name: 'Google Drive',
  description: 'Sync documents from Google Drive',
  version: '1.0.0',
  icon: GoogleDriveIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-drive',
    requiredScopes: ['https://www.googleapis.com/auth/drive'],
    adminCredentialType: 'service_account',
    /**
     * The administrator enumerates Workspace users and resolves directory grants.
     * Each user's content token has only the Drive read scope.
     */
    serviceAccountScopes: ['https://www.googleapis.com/auth/drive.readonly'],
    adminServiceAccountScopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.group.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly',
    ],
    serviceAccountDelegationScopes: ['https://www.googleapis.com/auth/drive.readonly'],
    serviceAccountSubjectFieldId: GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID,
  },

  /** `files.list` under a member's token returns only what that member can open. */
  permissionScopedListing: { capFieldIds: ['maxFiles'] },
  /** Drive file IDs and exported file bodies are shared across authorized readers. */
  supportsSeparateContentCredential: true,

  /** `files.list` reports each file's own permissions, so one crawl can mirror them. */
  mirrorsSourceAcls: true,
  adminSetupHint:
    'Use a service account with domain-wide delegation and Google Workspace Directory access to index selected employees’ Drives with their existing permissions.',

  configFields: [
    {
      id: GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID,
      title: 'Crawl as',
      titleInAdminMode: 'Directory administrator email',
      descriptionInAdminMode:
        'A Google Workspace administrator who can read users, groups, memberships, and domains. Used for directory access; files are read as each selected user.',
      type: 'short-input',
      required: false,
      placeholder: 'admin@yourcompany.com',
      description:
        'The Google Workspace user this service account acts as when fetching content for connected members.',
    },
    {
      id: 'userEmails',
      title: 'Users',
      showInAdminModeOnly: true,
      setupGroup: 'options',
      type: 'short-input',
      multi: true,
      required: false,
      placeholder: 'All active Google Workspace users',
      description:
        'Optional primary email addresses, separated by commas (up to 100). Leave blank to index all active users across this Google Workspace customer.',
    },
    {
      id: GOOGLE_DRIVE_OPEN_SHARING_FIELD_ID,
      title: 'Openly shared files',
      placeholder: 'Keep out of search',
      type: 'dropdown',
      required: false,
      hideInMemberMode: true,
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
      description: 'Includes files in each selected folder and its accessible subfolders.',
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
      description: 'Includes files in each selected folder and its accessible subfolders.',
      required: false,
    },
    {
      id: 'fileType',
      setupGroup: 'options',
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
      setupGroup: 'options',
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
