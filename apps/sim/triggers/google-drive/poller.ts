import { GoogleDriveIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

const MIME_TYPE_OPTIONS = [
  { id: '', label: 'All Files' },
  { id: 'application/vnd.google-apps.document', label: 'Google Docs' },
  { id: 'application/vnd.google-apps.spreadsheet', label: 'Google Sheets' },
  { id: 'application/vnd.google-apps.presentation', label: 'Google Slides' },
  { id: 'application/pdf', label: 'PDFs' },
  { id: 'image/', label: 'Images' },
  { id: 'application/vnd.google-apps.folder', label: 'Folders' },
] as const

export const googleDrivePollingTrigger: TriggerConfig = {
  id: 'google_drive_poller',
  name: 'Google Drive File Trigger',
  provider: 'google-drive',
  description: 'Triggers when files are created, modified, or deleted in Google Drive',
  version: '1.0.0',
  icon: GoogleDriveIcon,
  polling: true,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'Connect your Google account to access Google Drive.',
      serviceId: 'google-drive',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
      supportsCredentialSets: true,
      canonicalParamId: 'oauthCredential',
    },
    {
      id: 'folderId',
      title: 'Folder',
      type: 'file-selector',
      description: 'Optional: The folder to monitor. Leave empty to monitor all files in Drive.',
      required: false,
      mode: 'trigger',
      canonicalParamId: 'folderId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      mimeType: 'application/vnd.google-apps.folder',
      dependsOn: ['triggerCredentials'],
    },
    {
      id: 'manualFolderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Leave empty to monitor entire Drive',
      description:
        'Optional: The folder ID from the Google Drive URL to monitor. Leave empty to monitor all files.',
      required: false,
      mode: 'trigger-advanced',
      canonicalParamId: 'folderId',
    },
    {
      id: 'mimeTypeFilter',
      title: 'File Type Filter',
      type: 'dropdown',
      options: [...MIME_TYPE_OPTIONS],
      defaultValue: '',
      description: 'Optional: Only trigger for specific file types.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'eventTypeFilter',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { id: '', label: 'All Changes' },
        { id: 'created', label: 'File Created' },
        { id: 'modified', label: 'File Modified' },
        { id: 'deleted', label: 'File Deleted' },
        { id: 'created_or_modified', label: 'Created or Modified' },
      ],
      defaultValue: '',
      description: 'Only trigger for specific change types. Defaults to all changes.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'includeSharedDrives',
      title: 'Include Shared Drives',
      type: 'switch',
      defaultValue: false,
      description: 'Include files from shared (team) drives.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'google_drive_poller',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your Google account using OAuth credentials',
        'Optionally specify a folder ID to monitor a specific folder',
        'Optionally filter by file type',
        'The system will automatically detect new, modified, and deleted files',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    file: {
      id: {
        type: 'string',
        description: 'Google Drive file ID',
      },
      name: {
        type: 'string',
        description: 'File name',
      },
      mimeType: {
        type: 'string',
        description: 'File MIME type',
      },
      modifiedTime: {
        type: 'string',
        description: 'Last modified time (ISO)',
      },
      createdTime: {
        type: 'string',
        description: 'File creation time (ISO)',
      },
      size: {
        type: 'string',
        description: 'File size in bytes',
      },
      webViewLink: {
        type: 'string',
        description: 'URL to view file in browser',
      },
      parents: {
        type: 'json',
        description: 'Parent folder IDs',
      },
      lastModifyingUser: {
        type: 'json',
        description: 'User who last modified the file',
      },
      shared: {
        type: 'boolean',
        description: 'Whether file is shared',
      },
      starred: {
        type: 'boolean',
        description: 'Whether file is starred',
      },
    },
    eventType: {
      type: 'string',
      description: 'Change type: "created", "modified", or "deleted"',
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp in ISO format',
    },
  },
}
