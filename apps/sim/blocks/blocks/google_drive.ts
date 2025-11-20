import { GoogleDriveIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleDriveResponse } from '@/tools/google_drive/types'

export const GoogleDriveBlock: BlockConfig<GoogleDriveResponse> = {
  type: 'google_drive',
  name: 'Google Drive',
  description: 'Create, upload, and list files',
  authMode: AuthMode.OAuth,
  longDescription: 'Integrate Google Drive into the workflow. Can create, upload, and list files.',
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
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Create File', id: 'create_file' },
        { label: 'Upload File', id: 'upload' },
        { label: 'Download File', id: 'download' },
        { label: 'List Files', id: 'list' },
      ],
      value: () => 'create_folder',
    },
    // Google Drive Credentials
    {
      id: 'credential',
      title: 'Google Drive Account',
      type: 'oauth-input',
      required: true,
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
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
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
      ],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: ['create_file', 'upload'] },
    },
    {
      id: 'manualFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'folderId',
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
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
      ],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'create_folder' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'manualFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'folderId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_folder' },
    },
    // List Fields - Folder Selector (basic mode)
    {
      id: 'folderSelector',
      title: 'Select Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
      ],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a folder to list files from',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'list' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'manualFolderId',
      title: 'Folder ID',
      type: 'short-input',
      canonicalParamId: 'folderId',
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
      id: 'fileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'fileId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
      ],
      placeholder: 'Select a file to download',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'download' },
    },
    // Manual File ID input (advanced mode)
    {
      id: 'manualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'fileId',
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
  ],
  tools: {
    access: [
      'google_drive_upload',
      'google_drive_create_folder',
      'google_drive_download',
      'google_drive_list',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_file':
          case 'upload':
            return 'google_drive_upload'
          case 'create_folder':
            return 'google_drive_create_folder'
          case 'download':
            return 'google_drive_download'
          case 'list':
            return 'google_drive_list'
          default:
            throw new Error(`Invalid Google Drive operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          folderSelector,
          manualFolderId,
          fileSelector,
          manualFileId,
          mimeType,
          ...rest
        } = params

        // Use folderSelector if provided, otherwise use manualFolderId
        const effectiveFolderId = (folderSelector || manualFolderId || '').trim()

        // Use fileSelector if provided, otherwise use manualFileId
        const effectiveFileId = (fileSelector || manualFileId || '').trim()

        return {
          credential,
          folderId: effectiveFolderId || undefined,
          fileId: effectiveFileId || undefined,
          pageSize: rest.pageSize ? Number.parseInt(rest.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Google Drive access token' },
    // Upload and Create Folder operation inputs
    fileName: { type: 'string', description: 'File or folder name' },
    file: { type: 'json', description: 'File to upload (UserFile object)' },
    content: { type: 'string', description: 'Text content to upload' },
    mimeType: { type: 'string', description: 'File MIME type or export format' },
    // Download operation inputs
    fileSelector: { type: 'string', description: 'Selected file to download' },
    manualFileId: { type: 'string', description: 'Manual file identifier' },
    // List operation inputs
    folderSelector: { type: 'string', description: 'Selected folder' },
    manualFolderId: { type: 'string', description: 'Manual folder identifier' },
    query: { type: 'string', description: 'Search query' },
    pageSize: { type: 'number', description: 'Results per page' },
  },
  outputs: {
    file: { type: 'json', description: 'File data' },
    files: { type: 'json', description: 'Files list' },
  },
}
