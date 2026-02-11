import { GoogleDriveIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { GoogleDriveResponse } from '@/tools/google_drive/types'

export const GoogleDriveBlock: BlockConfig<GoogleDriveResponse> = {
  type: 'google_drive',
  name: 'Google Drive',
  description: 'Manage files, folders, and permissions',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Google Drive into the workflow. Can create, upload, download, copy, move, delete, share files and manage permissions.',
  docsLink: 'https://docs.sim.ai/tools/google_drive',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleDriveIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Files', id: 'list' },
        { label: 'Get File Info', id: 'get_file' },
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Create File', id: 'create_file' },
        { label: 'Upload File', id: 'upload' },
        { label: 'Download File', id: 'download' },
        { label: 'Copy File', id: 'copy' },
        { label: 'Update File', id: 'update' },
        { label: 'Move to Trash', id: 'trash' },
        { label: 'Delete Permanently', id: 'delete' },
        { label: 'Share File', id: 'share' },
        { label: 'Remove Sharing', id: 'unshare' },
        { label: 'List Permissions', id: 'list_permissions' },
        { label: 'Get Drive Info', id: 'get_about' },
      ],
      value: () => 'list',
    },
    // Google Drive Credentials
    {
      id: 'credential',
      title: 'Google Drive Account',
      type: 'oauth-input',
      required: true,
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select Google Drive account',
    },
    // Create/Upload File Fields
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Name of the file (e.g., document.txt)',
      condition: { field: 'operation', value: ['create_file', 'upload'] },
      required: true,
    },
    // File upload (basic mode) - binary files
    {
      id: 'fileUpload',
      title: 'Upload File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file to Google Drive',
      condition: { field: 'operation', value: 'upload' },
      mode: 'basic',
      multiple: false,
      required: false,
    },
    // Variable reference (advanced mode) - for referencing files from previous blocks
    {
      id: 'file',
      title: 'File Reference',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous block (e.g., {{block_name.file}})',
      condition: { field: 'operation', value: 'upload' },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'content',
      title: 'Text Content',
      type: 'long-input',
      placeholder: 'Text content for the file',
      condition: { field: 'operation', value: 'create_file' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate file content based on the user's description.
Create well-structured content appropriate for the file type.
For text files, use clear formatting and organization.
For HTML, include proper structure with appropriate tags.
For CSV, use proper comma-separated formatting.

Return ONLY the file content - no explanations, no markdown code blocks, no extra text.`,
        placeholder: 'Describe the content you want to create...',
      },
    },
    {
      id: 'mimeType',
      title: 'MIME Type',
      type: 'dropdown',
      options: [
        { label: 'Plain Text (text/plain)', id: 'text/plain' },
        { label: 'Google Doc', id: 'application/vnd.google-apps.document' },
        { label: 'Google Sheet', id: 'application/vnd.google-apps.spreadsheet' },
        { label: 'Google Slides', id: 'application/vnd.google-apps.presentation' },
        { label: 'HTML (text/html)', id: 'text/html' },
        { label: 'CSV (text/csv)', id: 'text/csv' },
        { label: 'PDF (application/pdf)', id: 'application/pdf' },
      ],
      placeholder: 'Select file type',
      condition: { field: 'operation', value: 'create_file' },
      required: false,
    },
    {
      id: 'uploadFolderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'uploadFolderId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: ['create_file', 'upload'] },
    },
    {
      id: 'uploadManualFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'uploadFolderId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_file', 'upload'] },
    },
    // Get Content Fields
    // {
    //   id: 'fileId',
    //   title: 'Select File',
    //   type: 'file-selector',
    //   provider: 'google-drive',
    //   serviceId: 'google-drive',
    //   requiredScopes: [],
    //   placeholder: 'Select a file',
    //   condition: { field: 'operation', value: 'get_content' },
    // },
    // // Manual File ID input (shown only when no file is selected)
    // {
    //   id: 'fileId',
    //   title: 'Or Enter File ID Manually',
    //   type: 'short-input',
    //   placeholder: 'ID of the file to get content from',
    //   condition: {
    //     field: 'operation',
    //     value: 'get_content',
    //     and: {
    //       field: 'fileId',
    //       value: '',
    //     },
    //   },
    // },
    // Export format for Google Workspace files
    // {
    //   id: 'mimeType',
    //   title: 'Export Format',
    //   type: 'dropdown',
    //   options: [
    //     { label: 'Plain Text', id: 'text/plain' },
    //     { label: 'HTML', id: 'text/html' },
    //   ],
    //   placeholder: 'Optional: Choose export format for Google Workspace files',
    //   condition: { field: 'operation', value: 'get_content' },
    // },
    // Create Folder Fields
    {
      id: 'fileName',
      title: 'Folder Name',
      type: 'short-input',
      placeholder: 'Name for the new folder',
      condition: { field: 'operation', value: 'create_folder' },
      required: true,
    },
    {
      id: 'createFolderParentSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'createFolderParentId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'create_folder' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'createFolderManualParentId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'createFolderParentId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_folder' },
    },
    // List Fields - Folder Selector (basic mode)
    {
      id: 'listFolderSelector',
      title: 'Select Folder',
      type: 'file-selector',
      canonicalParamId: 'listFolderId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a folder to list files from',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'list' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'listManualFolderId',
      title: 'Folder ID',
      type: 'short-input',
      canonicalParamId: 'listFolderId',
      placeholder: 'Enter folder ID (leave empty for root folder)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search for specific files (e.g., name contains "report")',
      condition: { field: 'operation', value: 'list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google Drive search query based on the user's description.
Use Google Drive query syntax:
- name contains 'term' - search by filename
- mimeType = 'type' - filter by file type
- modifiedTime > 'date' - filter by date
- 'email' in owners - filter by owner
- fullText contains 'term' - search file contents

Examples:
- "PDF files" -> mimeType = 'application/pdf'
- "files named report" -> name contains 'report'
- "spreadsheets modified today" -> mimeType = 'application/vnd.google-apps.spreadsheet' and modifiedTime > '2024-01-01'

Return ONLY the query string - no explanations, no quotes around the whole thing, no extra text.`,
        placeholder: 'Describe the files you want to find...',
      },
    },
    {
      id: 'pageSize',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'Number of results (default: 100, max: 1000)',
      condition: { field: 'operation', value: 'list' },
    },
    // Download File Fields - File Selector (basic mode)
    {
      id: 'downloadFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'downloadFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to download',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'download' },
      required: true,
    },
    // Manual File ID input (advanced mode)
    {
      id: 'downloadManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'downloadFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'download' },
      required: true,
    },
    // Export format for Google Workspace files (download operation)
    {
      id: 'mimeType',
      title: 'Export Format',
      type: 'dropdown',
      options: [
        { label: 'Plain Text (text/plain)', id: 'text/plain' },
        { label: 'HTML (text/html)', id: 'text/html' },
        { label: 'PDF (application/pdf)', id: 'application/pdf' },
        {
          label: 'DOCX (MS Word)',
          id: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        {
          label: 'XLSX (MS Excel)',
          id: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        {
          label: 'PPTX (MS PowerPoint)',
          id: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
        { label: 'CSV (text/csv)', id: 'text/csv' },
      ],
      placeholder: 'Optional: Choose export format for Google Docs/Sheets/Slides',
      condition: { field: 'operation', value: 'download' },
    },
    {
      id: 'fileName',
      title: 'File Name Override',
      type: 'short-input',
      placeholder: 'Optional: Override the filename',
      condition: { field: 'operation', value: 'download' },
    },
    // Get File Info Fields
    {
      id: 'getFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'getFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to get info for',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'get_file' },
      required: true,
    },
    {
      id: 'getManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'getFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_file' },
      required: true,
    },
    // Copy File Fields
    {
      id: 'copyFileSelector',
      title: 'Select File to Copy',
      type: 'file-selector',
      canonicalParamId: 'copyFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to copy',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'copy' },
      required: true,
    },
    {
      id: 'copyManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'copyFileId',
      placeholder: 'Enter file ID to copy',
      mode: 'advanced',
      condition: { field: 'operation', value: 'copy' },
      required: true,
    },
    {
      id: 'newName',
      title: 'New File Name',
      type: 'short-input',
      placeholder: 'Name for the copy (optional)',
      condition: { field: 'operation', value: 'copy' },
    },
    {
      id: 'copyDestFolderSelector',
      title: 'Destination Folder',
      type: 'file-selector',
      canonicalParamId: 'copyDestFolderId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select destination folder (optional)',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'copy' },
    },
    {
      id: 'copyManualDestFolderId',
      title: 'Destination Folder ID',
      type: 'short-input',
      canonicalParamId: 'copyDestFolderId',
      placeholder: 'Enter destination folder ID (optional)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'copy' },
    },
    // Update File Fields
    {
      id: 'updateFileSelector',
      title: 'Select File to Update',
      type: 'file-selector',
      canonicalParamId: 'updateFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to update',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'updateManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'updateFileId',
      placeholder: 'Enter file ID to update',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update' },
      required: true,
    },
    {
      id: 'name',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'New name for the file (optional)',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'New description for the file (optional)',
      condition: { field: 'operation', value: 'update' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, informative file description based on the user's input.
The description should help users understand the file's purpose and contents.
Keep it concise but comprehensive - typically 1-3 sentences.

Return ONLY the description text - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe what this file is about...',
      },
    },
    {
      id: 'starred',
      title: 'Starred',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Star', id: 'true' },
        { label: 'Unstar', id: 'false' },
      ],
      placeholder: 'Star or unstar the file',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'addParents',
      title: 'Add to Folders',
      type: 'short-input',
      placeholder: 'Comma-separated folder IDs to add file to',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'removeParents',
      title: 'Remove from Folders',
      type: 'short-input',
      placeholder: 'Comma-separated folder IDs to remove file from',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update' },
    },
    // Trash File Fields
    {
      id: 'trashFileSelector',
      title: 'Select File to Trash',
      type: 'file-selector',
      canonicalParamId: 'trashFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to move to trash',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'trash' },
      required: true,
    },
    {
      id: 'trashManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'trashFileId',
      placeholder: 'Enter file ID to trash',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trash' },
      required: true,
    },
    // Delete File Fields
    {
      id: 'deleteFileSelector',
      title: 'Select File to Delete',
      type: 'file-selector',
      canonicalParamId: 'deleteFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to permanently delete',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    {
      id: 'deleteManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'deleteFileId',
      placeholder: 'Enter file ID to permanently delete',
      mode: 'advanced',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    // Share File Fields
    {
      id: 'shareFileSelector',
      title: 'Select File to Share',
      type: 'file-selector',
      canonicalParamId: 'shareFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to share',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'share' },
      required: true,
    },
    {
      id: 'shareManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'shareFileId',
      placeholder: 'Enter file ID to share',
      mode: 'advanced',
      condition: { field: 'operation', value: 'share' },
      required: true,
    },
    {
      id: 'shareType',
      title: 'Share With',
      type: 'dropdown',
      options: [
        { label: 'User (email)', id: 'user' },
        { label: 'Group (email)', id: 'group' },
        { label: 'Domain', id: 'domain' },
        { label: 'Anyone with link', id: 'anyone' },
      ],
      placeholder: 'Who to share with',
      condition: { field: 'operation', value: 'share' },
      required: true,
    },
    {
      id: 'role',
      title: 'Permission Level',
      type: 'dropdown',
      options: [
        { label: 'Viewer (read only)', id: 'reader' },
        { label: 'Commenter (view & comment)', id: 'commenter' },
        { label: 'Editor (can edit)', id: 'writer' },
        { label: 'Transfer Ownership', id: 'owner' },
      ],
      placeholder: 'Permission level',
      condition: { field: 'operation', value: 'share' },
      required: true,
    },
    {
      id: 'email',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'Email of user or group to share with',
      condition: {
        field: 'operation',
        value: 'share',
        and: { field: 'shareType', value: ['user', 'group'] },
      },
      required: true,
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Domain to share with (e.g., example.com)',
      condition: {
        field: 'operation',
        value: 'share',
        and: { field: 'shareType', value: 'domain' },
      },
      required: true,
    },
    {
      id: 'sendNotification',
      title: 'Send Notification',
      type: 'dropdown',
      options: [
        { label: 'Yes (default)', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      placeholder: 'Send email notification',
      condition: {
        field: 'operation',
        value: 'share',
        and: { field: 'shareType', value: ['user', 'group'] },
      },
    },
    {
      id: 'emailMessage',
      title: 'Custom Message',
      type: 'long-input',
      placeholder: 'Custom message for the notification email (optional)',
      condition: {
        field: 'operation',
        value: 'share',
        and: { field: 'shareType', value: ['user', 'group'] },
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a professional, friendly sharing notification message based on the user's input.
The message should clearly explain why the file is being shared and any relevant context.
Keep it concise and appropriate for a business email - typically 2-4 sentences.

Return ONLY the message text - no subject line, no greetings/signatures, no extra formatting.`,
        placeholder: 'Describe why you are sharing this file...',
      },
    },
    // Unshare (Remove Permission) Fields
    {
      id: 'unshareFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'unshareFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to remove sharing from',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'unshare' },
      required: true,
    },
    {
      id: 'unshareManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'unshareFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'unshare' },
      required: true,
    },
    {
      id: 'permissionId',
      title: 'Permission ID',
      type: 'short-input',
      placeholder: 'Permission ID to remove (use List Permissions to find)',
      condition: { field: 'operation', value: 'unshare' },
      required: true,
    },
    // List Permissions Fields
    {
      id: 'listPermissionsFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'listPermissionsFileId',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
      placeholder: 'Select a file to list permissions for',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'list_permissions' },
      required: true,
    },
    {
      id: 'listPermissionsManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'listPermissionsFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_permissions' },
      required: true,
    },
    // Get Drive Info has no additional fields (just needs credential)
  ],
  tools: {
    access: [
      'google_drive_list',
      'google_drive_get_file',
      'google_drive_create_folder',
      'google_drive_upload',
      'google_drive_download',
      'google_drive_copy',
      'google_drive_update',
      'google_drive_trash',
      'google_drive_delete',
      'google_drive_share',
      'google_drive_unshare',
      'google_drive_list_permissions',
      'google_drive_get_about',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list':
            return 'google_drive_list'
          case 'get_file':
            return 'google_drive_get_file'
          case 'create_folder':
            return 'google_drive_create_folder'
          case 'create_file':
          case 'upload':
            return 'google_drive_upload'
          case 'download':
            return 'google_drive_download'
          case 'copy':
            return 'google_drive_copy'
          case 'update':
            return 'google_drive_update'
          case 'trash':
            return 'google_drive_trash'
          case 'delete':
            return 'google_drive_delete'
          case 'share':
            return 'google_drive_share'
          case 'unshare':
            return 'google_drive_unshare'
          case 'list_permissions':
            return 'google_drive_list_permissions'
          case 'get_about':
            return 'google_drive_get_about'
          default:
            throw new Error(`Invalid Google Drive operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          // Folder canonical params (per-operation)
          uploadFolderId,
          createFolderParentId,
          listFolderId,
          copyDestFolderId,
          // File canonical params (per-operation)
          downloadFileId,
          getFileId,
          copyFileId,
          updateFileId,
          trashFileId,
          deleteFileId,
          shareFileId,
          unshareFileId,
          listPermissionsFileId,
          // File upload
          file,
          mimeType,
          shareType,
          starred,
          sendNotification,
          ...rest
        } = params

        // Normalize file input - handles both basic (file-upload) and advanced (short-input) modes
        const normalizedFile = normalizeFileInput(file, { single: true })

        // Resolve folderId based on operation
        let effectiveFolderId: string | undefined
        switch (params.operation) {
          case 'create_file':
          case 'upload':
            effectiveFolderId = uploadFolderId?.trim() || undefined
            break
          case 'create_folder':
            effectiveFolderId = createFolderParentId?.trim() || undefined
            break
          case 'list':
            effectiveFolderId = listFolderId?.trim() || undefined
            break
        }

        // Resolve fileId based on operation
        let effectiveFileId: string | undefined
        switch (params.operation) {
          case 'download':
            effectiveFileId = downloadFileId?.trim() || undefined
            break
          case 'get_file':
            effectiveFileId = getFileId?.trim() || undefined
            break
          case 'copy':
            effectiveFileId = copyFileId?.trim() || undefined
            break
          case 'update':
            effectiveFileId = updateFileId?.trim() || undefined
            break
          case 'trash':
            effectiveFileId = trashFileId?.trim() || undefined
            break
          case 'delete':
            effectiveFileId = deleteFileId?.trim() || undefined
            break
          case 'share':
            effectiveFileId = shareFileId?.trim() || undefined
            break
          case 'unshare':
            effectiveFileId = unshareFileId?.trim() || undefined
            break
          case 'list_permissions':
            effectiveFileId = listPermissionsFileId?.trim() || undefined
            break
        }

        // Resolve destinationFolderId for copy operation
        const effectiveDestinationFolderId =
          params.operation === 'copy' ? copyDestFolderId?.trim() || undefined : undefined

        // Convert starred dropdown to boolean
        const starredValue = starred === 'true' ? true : starred === 'false' ? false : undefined

        // Convert sendNotification dropdown to boolean
        const sendNotificationValue =
          sendNotification === 'true' ? true : sendNotification === 'false' ? false : undefined

        return {
          credential,
          folderId: effectiveFolderId,
          fileId: effectiveFileId,
          destinationFolderId: effectiveDestinationFolderId,
          file: normalizedFile,
          pageSize: rest.pageSize ? Number.parseInt(rest.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          type: shareType, // Map shareType to type for share tool
          starred: starredValue,
          sendNotification: sendNotificationValue,
          transferOwnership: rest.role === 'owner' ? true : undefined,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Drive access token' },
    // Folder canonical params (per-operation)
    uploadFolderId: { type: 'string', description: 'Parent folder for upload/create' },
    createFolderParentId: { type: 'string', description: 'Parent folder for create folder' },
    listFolderId: { type: 'string', description: 'Folder to list files from' },
    copyDestFolderId: { type: 'string', description: 'Destination folder for copy' },
    // File canonical params (per-operation)
    downloadFileId: { type: 'string', description: 'File to download' },
    getFileId: { type: 'string', description: 'File to get info for' },
    copyFileId: { type: 'string', description: 'File to copy' },
    updateFileId: { type: 'string', description: 'File to update' },
    trashFileId: { type: 'string', description: 'File to trash' },
    deleteFileId: { type: 'string', description: 'File to delete' },
    shareFileId: { type: 'string', description: 'File to share' },
    unshareFileId: { type: 'string', description: 'File to unshare' },
    listPermissionsFileId: { type: 'string', description: 'File to list permissions for' },
    // Upload and Create inputs
    fileName: { type: 'string', description: 'File or folder name' },
    file: { type: 'json', description: 'File to upload (UserFile object)' },
    content: { type: 'string', description: 'Text content to upload' },
    mimeType: { type: 'string', description: 'File MIME type or export format' },
    // List operation inputs
    query: { type: 'string', description: 'Search query' },
    pageSize: { type: 'number', description: 'Results per page' },
    // Copy operation inputs
    newName: { type: 'string', description: 'New name for copied file' },
    // Update operation inputs
    name: { type: 'string', description: 'New name for file' },
    description: { type: 'string', description: 'New description for file' },
    starred: { type: 'string', description: 'Star or unstar the file' },
    addParents: { type: 'string', description: 'Folder IDs to add file to' },
    removeParents: { type: 'string', description: 'Folder IDs to remove file from' },
    // Share operation inputs
    shareType: { type: 'string', description: 'Type of sharing (user, group, domain, anyone)' },
    role: { type: 'string', description: 'Permission role' },
    email: { type: 'string', description: 'Email address to share with' },
    domain: { type: 'string', description: 'Domain to share with' },
    sendNotification: { type: 'string', description: 'Send notification email' },
    emailMessage: { type: 'string', description: 'Custom notification message' },
    // Unshare operation inputs
    permissionId: { type: 'string', description: 'Permission ID to remove' },
  },
  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    files: { type: 'json', description: 'List of files' },
    metadata: { type: 'json', description: 'Complete file metadata (from download)' },
    content: { type: 'string', description: 'File content as text' },
    nextPageToken: { type: 'string', description: 'Token for fetching the next page of results' },
    permission: { type: 'json', description: 'Permission details' },
    permissions: { type: 'json', description: 'List of permissions' },
    user: { type: 'json', description: 'User information' },
    storageQuota: { type: 'json', description: 'Storage quota information' },
    canCreateDrives: { type: 'boolean', description: 'Whether user can create shared drives' },
    importFormats: { type: 'json', description: 'Map of MIME types that can be imported' },
    exportFormats: {
      type: 'json',
      description: 'Map of Google Workspace MIME types and export formats',
    },
    maxUploadSize: { type: 'string', description: 'Maximum upload size in bytes' },
    deleted: { type: 'boolean', description: 'Whether file was deleted' },
    removed: { type: 'boolean', description: 'Whether permission was removed' },
  },
}
