import { BookOpen } from '@sim/emcn/icons'
import { GoogleDriveIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
import type { GoogleDriveResponse } from '@/tools/google_drive/types'
import { getTrigger } from '@/triggers'

export const GoogleDriveBlock: BlockConfig<GoogleDriveResponse> = {
  type: 'google_drive',
  name: 'Google Drive',
  description: 'Manage files, folders, and permissions',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Google Drive into the workflow. Can create, upload, download, copy, move, delete, share files and manage permissions.',
  docsLink: 'https://docs.sim.ai/integrations/google_drive',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: GoogleDriveIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Files', id: 'list' },
        { label: 'Search Files', id: 'search' },
        { label: 'Get File Info', id: 'get_file' },
        { label: 'Get File Content', id: 'get_content' },
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Create File', id: 'create_file' },
        { label: 'Upload File', id: 'upload' },
        { label: 'Download File', id: 'download' },
        { label: 'Copy File', id: 'copy' },
        { label: 'Move File', id: 'move' },
        { label: 'Update File', id: 'update' },
        { label: 'Move to Trash', id: 'trash' },
        { label: 'Restore from Trash', id: 'untrash' },
        { label: 'Delete Permanently', id: 'delete' },
        { label: 'Share File', id: 'share' },
        { label: 'Remove Sharing', id: 'unshare' },
        { label: 'List Permissions', id: 'list_permissions' },
        { label: 'Export File', id: 'export' },
        { label: 'List Revisions', id: 'list_revisions' },
        { label: 'Get Revision', id: 'get_revision' },
        { label: 'List Comments', id: 'list_comments' },
        { label: 'Create Comment', id: 'create_comment' },
        { label: 'Delete Comment', id: 'delete_comment' },
        { label: 'Get Drive Info', id: 'get_about' },
      ],
      value: () => 'list',
    },
    // Google Drive Credentials
    {
      id: 'credential',
      title: 'Google Drive Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select Google Drive account',
    },
    {
      id: 'manualCredential',
      title: 'Google Drive Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      placeholder: 'Number of results (default: 100, max: 100)',
      condition: { field: 'operation', value: 'list' },
    },
    // Download File Fields - File Selector (basic mode)
    {
      id: 'downloadFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'downloadFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
        { label: 'Auto (best format for file type)', id: 'auto' },
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
      value: () => 'auto',
      placeholder: 'Export format for Google Docs/Sheets/Slides',
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
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
    // Get File Content Fields
    {
      id: 'getContentFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'getContentFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select a file to get content from',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'get_content' },
      required: true,
    },
    {
      id: 'getContentManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'getContentFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_content' },
      required: true,
    },
    {
      id: 'getContentExportMimeType',
      title: 'Export Format',
      type: 'dropdown',
      options: [
        { label: 'Auto (best format for file type)', id: 'auto' },
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
      value: () => 'auto',
      placeholder: 'Export format for Google Workspace files',
      condition: { field: 'operation', value: 'get_content' },
    },
    {
      id: 'getContentIncludeRevisions',
      title: 'Include Revisions',
      type: 'dropdown',
      canonicalParamId: 'includeRevisions',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes (full revision history)', id: 'true' },
      ],
      value: () => 'false',
      placeholder: 'Include revision history',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_content' },
    },
    // Move File Fields
    {
      id: 'moveFileSelector',
      title: 'Select File to Move',
      type: 'file-selector',
      canonicalParamId: 'moveFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select a file to move',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'move' },
      required: true,
    },
    {
      id: 'moveManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'moveFileId',
      placeholder: 'Enter file ID to move',
      mode: 'advanced',
      condition: { field: 'operation', value: 'move' },
      required: true,
    },
    {
      id: 'moveDestFolderSelector',
      title: 'Destination Folder',
      type: 'file-selector',
      canonicalParamId: 'moveDestFolderId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select destination folder',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'move' },
      required: true,
    },
    {
      id: 'moveManualDestFolderId',
      title: 'Destination Folder ID',
      type: 'short-input',
      canonicalParamId: 'moveDestFolderId',
      placeholder: 'Enter destination folder ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'move' },
      required: true,
    },
    {
      id: 'moveRemoveFromCurrent',
      title: 'Remove from Current Folder',
      type: 'dropdown',
      canonicalParamId: 'removeFromCurrent',
      options: [
        { label: 'Yes (default)', id: 'true' },
        { label: 'No (add to destination, keep in current)', id: 'false' },
      ],
      placeholder: 'Remove from current folder',
      mode: 'advanced',
      condition: { field: 'operation', value: 'move' },
    },
    // Search Files Fields
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'long-input',
      placeholder:
        "Drive query syntax (e.g., fullText contains 'budget' and mimeType = 'application/pdf')",
      condition: { field: 'operation', value: 'search' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Google Drive search query based on the user's description.
Use Google Drive query syntax:
- name contains 'term' - search by filename
- fullText contains 'term' - search file contents
- mimeType = 'type' - filter by file type (e.g., 'application/pdf', 'application/vnd.google-apps.document')
- modifiedTime > 'YYYY-MM-DDTHH:MM:SS' - filter by date
- 'email' in owners - filter by owner
- trashed = false - exclude trashed files
- starred = true - only starred files
- 'folderId' in parents - files in a specific folder

Combine with 'and' / 'or' / 'not'. Example:
- "PDFs about budget modified this year" -> mimeType = 'application/pdf' and fullText contains 'budget' and modifiedTime > '2024-01-01T00:00:00'
- "starred Google Docs" -> mimeType = 'application/vnd.google-apps.document' and starred = true

Return ONLY the query string - no explanations, no quotes around the whole thing, no extra text.`,
        placeholder: 'Describe the files you want to find...',
      },
    },
    {
      id: 'searchPageSize',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'Number of results (default: 100, max: 100)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'search' },
    },
    // Untrash File Fields
    {
      id: 'untrashFileSelector',
      title: 'Select File to Restore',
      type: 'file-selector',
      canonicalParamId: 'untrashFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select a file to restore from trash',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'untrash' },
      required: true,
    },
    {
      id: 'untrashManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'untrashFileId',
      placeholder: 'Enter file ID to restore',
      mode: 'advanced',
      condition: { field: 'operation', value: 'untrash' },
      required: true,
    },
    {
      id: 'exportFileSelector',
      title: 'Select File to Export',
      type: 'file-selector',
      canonicalParamId: 'exportFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select a Google Workspace file to export',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'export' },
      required: true,
    },
    {
      id: 'exportManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'exportFileId',
      placeholder: 'Enter file ID to export',
      mode: 'advanced',
      condition: { field: 'operation', value: 'export' },
      required: true,
    },
    {
      id: 'exportMimeType',
      title: 'Export Format',
      type: 'dropdown',
      options: [
        { label: 'PDF (application/pdf)', id: 'application/pdf' },
        { label: 'Plain Text (text/plain)', id: 'text/plain' },
        { label: 'HTML (text/html)', id: 'text/html' },
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
        { label: 'PNG (image/png)', id: 'image/png' },
        { label: 'SVG (image/svg+xml)', id: 'image/svg+xml' },
      ],
      placeholder: 'Select the format to export to',
      condition: { field: 'operation', value: 'export' },
      required: true,
    },
    {
      id: 'fileName',
      title: 'File Name Override',
      type: 'short-input',
      placeholder: 'Optional: Override the exported filename',
      condition: { field: 'operation', value: 'export' },
    },
    {
      id: 'listRevisionsFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'listRevisionsFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select a file to list revisions for',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'list_revisions' },
      required: true,
    },
    {
      id: 'listRevisionsManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'listRevisionsFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_revisions' },
      required: true,
    },
    {
      id: 'revisionsPageSize',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'Number of revisions (default: 200, max: 1000)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_revisions' },
    },
    {
      id: 'getRevisionFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'getRevisionFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select a file',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'get_revision' },
      required: true,
    },
    {
      id: 'getRevisionManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'getRevisionFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_revision' },
      required: true,
    },
    {
      id: 'revisionId',
      title: 'Revision ID',
      type: 'short-input',
      placeholder: 'Enter the revision ID (use List Revisions to find)',
      condition: { field: 'operation', value: 'get_revision' },
      required: true,
    },
    {
      id: 'listCommentsFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'listCommentsFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select a file to list comments for',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'list_comments' },
      required: true,
    },
    {
      id: 'listCommentsManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'listCommentsFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_comments' },
      required: true,
    },
    {
      id: 'commentsPageSize',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'Number of comments (default: 20, max: 100)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_comments' },
    },
    {
      id: 'includeDeleted',
      title: 'Include Deleted Comments',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      placeholder: 'Include deleted comments',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_comments' },
    },
    {
      id: 'createCommentFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'createCommentFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select a file to comment on',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'create_comment' },
      required: true,
    },
    {
      id: 'createCommentManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'createCommentFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_comment' },
      required: true,
    },
    {
      id: 'content',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'The text of your comment',
      condition: { field: 'operation', value: 'create_comment' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, professional comment for a Google Drive file based on the user's input.
Keep it concise and actionable - typically 1-3 sentences.

Return ONLY the comment text - no explanations, no quotes, no extra formatting.`,
        placeholder: 'Describe the comment you want to leave...',
      },
    },
    {
      id: 'anchor',
      title: 'Anchor',
      type: 'short-input',
      placeholder: 'Optional: JSON anchor describing the region the comment refers to',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_comment' },
    },
    {
      id: 'deleteCommentFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'deleteCommentFileId',
      serviceId: 'google-drive',
      selectorKey: 'google.drive',
      requiredScopes: getScopesForService('google-drive'),
      placeholder: 'Select the file the comment belongs to',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'delete_comment' },
      required: true,
    },
    {
      id: 'deleteCommentManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'deleteCommentFileId',
      placeholder: 'Enter file ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'delete_comment' },
      required: true,
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Enter the comment ID to delete (use List Comments to find)',
      condition: { field: 'operation', value: 'delete_comment' },
      required: true,
    },
    // Get Drive Info has no additional fields (just needs credential)
    ...getTrigger('google_drive_poller').subBlocks,
  ],
  tools: {
    access: [
      'google_drive_list',
      'google_drive_get_file',
      'google_drive_get_content',
      'google_drive_create_folder',
      'google_drive_upload',
      'google_drive_download',
      'google_drive_copy',
      'google_drive_move',
      'google_drive_search',
      'google_drive_update',
      'google_drive_trash',
      'google_drive_untrash',
      'google_drive_delete',
      'google_drive_share',
      'google_drive_unshare',
      'google_drive_list_permissions',
      'google_drive_export',
      'google_drive_list_revisions',
      'google_drive_get_revision',
      'google_drive_list_comments',
      'google_drive_create_comment',
      'google_drive_delete_comment',
      'google_drive_get_about',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list':
            return 'google_drive_list'
          case 'search':
            return 'google_drive_search'
          case 'get_file':
            return 'google_drive_get_file'
          case 'get_content':
            return 'google_drive_get_content'
          case 'create_folder':
            return 'google_drive_create_folder'
          case 'create_file':
          case 'upload':
            return 'google_drive_upload'
          case 'download':
            return 'google_drive_download'
          case 'copy':
            return 'google_drive_copy'
          case 'move':
            return 'google_drive_move'
          case 'update':
            return 'google_drive_update'
          case 'trash':
            return 'google_drive_trash'
          case 'untrash':
            return 'google_drive_untrash'
          case 'delete':
            return 'google_drive_delete'
          case 'share':
            return 'google_drive_share'
          case 'unshare':
            return 'google_drive_unshare'
          case 'list_permissions':
            return 'google_drive_list_permissions'
          case 'export':
            return 'google_drive_export'
          case 'list_revisions':
            return 'google_drive_list_revisions'
          case 'get_revision':
            return 'google_drive_get_revision'
          case 'list_comments':
            return 'google_drive_list_comments'
          case 'create_comment':
            return 'google_drive_create_comment'
          case 'delete_comment':
            return 'google_drive_delete_comment'
          case 'get_about':
            return 'google_drive_get_about'
          default:
            throw new Error(`Invalid Google Drive operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          // Folder canonical params (per-operation)
          uploadFolderId,
          createFolderParentId,
          listFolderId,
          copyDestFolderId,
          moveDestFolderId,
          // File canonical params (per-operation)
          downloadFileId,
          getFileId,
          getContentFileId,
          copyFileId,
          moveFileId,
          updateFileId,
          trashFileId,
          untrashFileId,
          deleteFileId,
          shareFileId,
          unshareFileId,
          listPermissionsFileId,
          exportFileId,
          listRevisionsFileId,
          getRevisionFileId,
          listCommentsFileId,
          createCommentFileId,
          deleteCommentFileId,
          // File upload
          file,
          mimeType,
          shareType,
          starred,
          sendNotification,
          removeFromCurrent,
          includeRevisions,
          includeDeleted,
          pageSize,
          query,
          searchQuery,
          searchPageSize,
          revisionsPageSize,
          commentsPageSize,
          getContentExportMimeType,
          exportMimeType,
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
          case 'get_content':
            effectiveFileId = getContentFileId?.trim() || undefined
            break
          case 'copy':
            effectiveFileId = copyFileId?.trim() || undefined
            break
          case 'move':
            effectiveFileId = moveFileId?.trim() || undefined
            break
          case 'update':
            effectiveFileId = updateFileId?.trim() || undefined
            break
          case 'trash':
            effectiveFileId = trashFileId?.trim() || undefined
            break
          case 'untrash':
            effectiveFileId = untrashFileId?.trim() || undefined
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
          case 'export':
            effectiveFileId = exportFileId?.trim() || undefined
            break
          case 'list_revisions':
            effectiveFileId = listRevisionsFileId?.trim() || undefined
            break
          case 'get_revision':
            effectiveFileId = getRevisionFileId?.trim() || undefined
            break
          case 'list_comments':
            effectiveFileId = listCommentsFileId?.trim() || undefined
            break
          case 'create_comment':
            effectiveFileId = createCommentFileId?.trim() || undefined
            break
          case 'delete_comment':
            effectiveFileId = deleteCommentFileId?.trim() || undefined
            break
        }

        // Resolve destinationFolderId for copy/move operations
        let effectiveDestinationFolderId: string | undefined
        if (params.operation === 'copy') {
          effectiveDestinationFolderId = copyDestFolderId?.trim() || undefined
        } else if (params.operation === 'move') {
          effectiveDestinationFolderId = moveDestFolderId?.trim() || undefined
        }

        // Convert starred dropdown to boolean
        const starredValue = starred === 'true' ? true : starred === 'false' ? false : undefined

        // Convert sendNotification dropdown to boolean
        const sendNotificationValue =
          sendNotification === 'true' ? true : sendNotification === 'false' ? false : undefined

        // Convert removeFromCurrent dropdown to boolean
        const removeFromCurrentValue =
          removeFromCurrent === 'true' ? true : removeFromCurrent === 'false' ? false : undefined

        // Convert includeRevisions dropdown to boolean
        const includeRevisionsValue =
          includeRevisions === 'true' ? true : includeRevisions === 'false' ? false : undefined

        const includeDeletedValue =
          includeDeleted === 'true' ? true : includeDeleted === 'false' ? false : undefined

        let effectivePageSize: string | undefined = pageSize
        if (params.operation === 'search') effectivePageSize = searchPageSize
        else if (params.operation === 'list_revisions') effectivePageSize = revisionsPageSize
        else if (params.operation === 'list_comments') effectivePageSize = commentsPageSize

        const effectiveQuery = params.operation === 'search' ? searchQuery : query
        const effectiveMimeType =
          params.operation === 'get_content'
            ? getContentExportMimeType
            : params.operation === 'export'
              ? exportMimeType
              : mimeType

        return {
          oauthCredential,
          folderId: effectiveFolderId,
          fileId: effectiveFileId,
          destinationFolderId: effectiveDestinationFolderId,
          file: normalizedFile,
          pageSize: effectivePageSize
            ? Number.parseInt(effectivePageSize as string, 10)
            : undefined,
          query: effectiveQuery,
          mimeType: effectiveMimeType === 'auto' ? undefined : effectiveMimeType,
          type: shareType, // Map shareType to type for share tool
          starred: starredValue,
          sendNotification: sendNotificationValue,
          removeFromCurrent: removeFromCurrentValue,
          includeRevisions: includeRevisionsValue,
          includeDeleted: includeDeletedValue,
          transferOwnership: rest.role === 'owner' ? true : undefined,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Drive access token' },
    // Folder canonical params (per-operation)
    uploadFolderId: { type: 'string', description: 'Parent folder for upload/create' },
    createFolderParentId: { type: 'string', description: 'Parent folder for create folder' },
    listFolderId: { type: 'string', description: 'Folder to list files from' },
    copyDestFolderId: { type: 'string', description: 'Destination folder for copy' },
    moveDestFolderId: { type: 'string', description: 'Destination folder for move' },
    // File canonical params (per-operation)
    downloadFileId: { type: 'string', description: 'File to download' },
    getFileId: { type: 'string', description: 'File to get info for' },
    getContentFileId: { type: 'string', description: 'File to get content from' },
    copyFileId: { type: 'string', description: 'File to copy' },
    moveFileId: { type: 'string', description: 'File to move' },
    updateFileId: { type: 'string', description: 'File to update' },
    trashFileId: { type: 'string', description: 'File to trash' },
    untrashFileId: { type: 'string', description: 'File to restore from trash' },
    deleteFileId: { type: 'string', description: 'File to delete' },
    shareFileId: { type: 'string', description: 'File to share' },
    unshareFileId: { type: 'string', description: 'File to unshare' },
    listPermissionsFileId: { type: 'string', description: 'File to list permissions for' },
    exportFileId: { type: 'string', description: 'File to export' },
    listRevisionsFileId: { type: 'string', description: 'File to list revisions for' },
    getRevisionFileId: { type: 'string', description: 'File the revision belongs to' },
    listCommentsFileId: { type: 'string', description: 'File to list comments for' },
    createCommentFileId: { type: 'string', description: 'File to comment on' },
    deleteCommentFileId: { type: 'string', description: 'File the comment belongs to' },
    // Move operation inputs
    removeFromCurrent: {
      type: 'string',
      description: 'Whether to remove from current folder when moving',
    },
    // Get content operation inputs
    includeRevisions: { type: 'string', description: 'Whether to include revision history' },
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
    exportMimeType: { type: 'string', description: 'Target MIME type to export to' },
    revisionId: { type: 'string', description: 'Revision ID to retrieve' },
    revisionsPageSize: { type: 'string', description: 'Results per page for revisions' },
    commentId: { type: 'string', description: 'Comment ID to delete' },
    anchor: { type: 'string', description: 'Anchor region for a new comment' },
    includeDeleted: { type: 'string', description: 'Include deleted comments when listing' },
    commentsPageSize: { type: 'string', description: 'Results per page for comments' },
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
    deleted: { type: 'boolean', description: 'Whether file or comment was deleted' },
    removed: { type: 'boolean', description: 'Whether permission was removed' },
    exportedMimeType: { type: 'string', description: 'MIME type a file was exported to' },
    revisions: { type: 'json', description: 'List of file revisions' },
    revision: { type: 'json', description: 'A single file revision' },
    comments: { type: 'json', description: 'List of file comments' },
    comment: { type: 'json', description: 'A single file comment' },
    commentId: { type: 'string', description: 'ID of a deleted comment' },
  },
  triggers: {
    enabled: true,
    available: ['google_drive_poller'],
  },
}

export const GoogleDriveBlockMeta = {
  tags: ['cloud', 'google-workspace', 'document-processing'],
  url: 'https://workspace.google.com/products/drive',
  templates: [
    {
      icon: BookOpen,
      title: 'Personal knowledge assistant',
      prompt:
        'Create a knowledge base and connect it to my Google Drive, Notion, or Obsidian so all my notes, docs, and articles are automatically synced and embedded. Then build an agent that I can ask anything — it should answer with citations and deploy as a chat endpoint.',
      modules: ['knowledge-base', 'agent'],
      category: 'productivity',
      tags: ['individual', 'research', 'team'],
      alsoIntegrations: ['notion', 'obsidian'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Google Drive knowledge search',
      prompt:
        'Create a knowledge base connected to my Google Drive so all documents, spreadsheets, and presentations are automatically synced and searchable. Then build an agent I can ask things like "find the board deck from last quarter" or "what were the KPIs in the marketing plan?" and get answers with doc links.',
      modules: ['knowledge-base', 'agent'],
      category: 'productivity',
      tags: ['individual', 'team', 'research'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Google Drive contract intake',
      prompt:
        'Create a workflow that watches a Google Drive intake folder for new contract PDFs, extracts clauses with Reducto, writes structured terms to a table, and pings legal in Slack.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
      alsoIntegrations: ['reducto', 'slack'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Google Drive new-hire kit deployer',
      prompt:
        'Build a workflow triggered by a new hire in Greenhouse that copies the standard Google Drive onboarding folder, shares it with the new hire, and writes the link into the onboarding tracker.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['greenhouse'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Google Drive retention enforcer',
      prompt:
        'Create a scheduled monthly workflow that finds Google Drive files past the retention horizon, requires owner approval over Slack, and archives or deletes per the policy.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleDriveIcon,
      title: 'Drive intake auto-filer',
      prompt:
        "Build a workflow that watches a Google Drive intake folder for new uploads, reads each file's content to classify it by type and customer, creates the right destination folder, and moves the file there with a renamed, consistent filename.",
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'document-processing'],
    },
    {
      icon: BookOpen,
      title: 'Drive document Q&A assistant',
      prompt:
        'Create a knowledge base synced from a Google Drive folder, then build an agent that searches the synced documents to answer team questions and replies with the answer plus a link to the source file in Drive.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'research', 'sync'],
    },
  ],
  skills: [
    {
      name: 'find-file-in-drive',
      description:
        'Search Google Drive with query syntax to locate files by name, type, content, or date.',
      content:
        "# Find a File in Drive\n\nLocate files using Drive query syntax.\n\n## Steps\n1. Translate the request into a Drive query. Common clauses: `name contains 'term'`, `fullText contains 'term'`, `mimeType = 'application/pdf'`, `modifiedTime > '2024-01-01T00:00:00'`, `'email' in owners`, `trashed = false`.\n2. Run the Search Files operation with that query and a Results Per Page value.\n3. If results are too broad, add `and` clauses (file type, owner, date) to narrow.\n4. For a chosen result, run Get File Info for full metadata.\n\n## Output\nA list of matching files: name, type, owner, modified date, and the file ID. Highlight the single best match if the intent was specific.",
    },
    {
      name: 'organize-files-into-folders',
      description:
        'Create folders and move or copy files in Google Drive to keep storage organized.',
      content:
        '# Organize Files into Folders\n\nFile and tidy Drive content.\n\n## Steps\n1. Identify the target structure: which folder should exist and what goes in it.\n2. If the destination folder does not exist, run Create Folder (set its parent if needed) and capture the new folder ID.\n3. For each file to relocate, run Move File with the destination folder ID. Use Copy File instead when the original must stay in place.\n4. Optionally run Update File to rename files to a consistent convention.\n\n## Output\nA summary of what was created and moved: destination folder link, count of files relocated, and any renames applied.',
    },
    {
      name: 'share-file-with-people',
      description:
        'Grant access to a Google Drive file for users, groups, a domain, or anyone with the link.',
      content:
        '# Share a File\n\nGrant access to a Drive file with the right permission level.\n\n## Steps\n1. Obtain the file ID (select it or run Search Files).\n2. Decide the share target: a specific user/group email, an entire domain, or anyone with the link.\n3. Choose the permission level: Viewer (reader), Commenter, or Editor (writer).\n4. Run the Share File operation with the target and role. For user/group shares, optionally include a notification message.\n\n## Output\nConfirm who now has access and at what level, plus the file link. Avoid `anyone` unless explicitly requested.',
    },
    {
      name: 'read-file-content',
      description:
        'Extract the text content of a Google Drive file, exporting Workspace files to a usable format.',
      content:
        '# Read File Content\n\nPull the text out of a Drive file for downstream use.\n\n## Steps\n1. Obtain the file ID.\n2. Run the Get File Content operation. For Google Docs/Sheets/Slides, set Export Format (Auto picks the best, or choose Plain Text / PDF / DOCX explicitly).\n3. For non-Workspace files (PDF, TXT), the content is returned directly.\n4. Use the returned text for summarization, extraction, or indexing.\n\n## Output\nReturn the extracted content (or a summary of it if large), noting the file name and the export format used.',
    },
  ],
} as const satisfies BlockMeta
