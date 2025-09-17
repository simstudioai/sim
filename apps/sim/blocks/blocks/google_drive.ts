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
      layout: 'full',
      options: [
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Upload File', id: 'upload' },
        { label: 'List Files', id: 'list' },
      ],
      value: () => 'create_folder',
    },
    // Google Drive Credentials
    {
      id: 'credential',
      title: 'Google Drive Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
      placeholder: 'Select Google Drive account',
    },
    // Upload Fields
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the file',
      condition: { field: 'operation', value: 'upload' },
      required: true,
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Content to upload to the file',
      condition: { field: 'operation', value: 'upload' },
      required: true,
    },
    {
      id: 'mimeType',
      title: 'MIME Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Google Doc', id: 'application/vnd.google-apps.document' },
        { label: 'Google Sheet', id: 'application/vnd.google-apps.spreadsheet' },
        { label: 'Google Slides', id: 'application/vnd.google-apps.presentation' },
        { label: 'PDF (application/pdf)', id: 'application/pdf' },
      ],
      placeholder: 'Select a file type',
      condition: { field: 'operation', value: 'upload' },
    },
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'folderId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'upload' },
    },
    {
      id: 'manualFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'folderId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'upload' },
    },
    // Get Content Fields
    // {
    //   id: 'fileId',
    //   title: 'Select File',
    //   type: 'file-selector',
    //   layout: 'full',
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
    //   layout: 'full',
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
    //   layout: 'full',
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
      layout: 'full',
      placeholder: 'Name for the new folder',
      condition: { field: 'operation', value: 'create_folder' },
      required: true,
    },
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      layout: 'full',
      canonicalParamId: 'folderId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
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
      layout: 'full',
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
      layout: 'full',
      canonicalParamId: 'folderId',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
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
      layout: 'full',
      canonicalParamId: 'folderId',
      placeholder: 'Enter folder ID (leave empty for root folder)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Search for specific files (e.g., name contains "report")',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'pageSize',
      title: 'Results Per Page',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Number of results (default: 100, max: 1000)',
      condition: { field: 'operation', value: 'list' },
    },
  ],
  tools: {
    access: ['google_drive_upload', 'google_drive_create_folder', 'google_drive_list'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'upload':
            return 'google_drive_upload'
          case 'create_folder':
            return 'google_drive_create_folder'
          case 'list':
            return 'google_drive_list'
          default:
            throw new Error(`Invalid Google Drive operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, folderSelector, manualFolderId, mimeType, ...rest } = params

        // Use folderSelector if provided, otherwise use manualFolderId
        const effectiveFolderId = (folderSelector || manualFolderId || '').trim()

        return {
          credential,
          folderId: effectiveFolderId || undefined,
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
    content: { type: 'string', description: 'File content' },
    mimeType: { type: 'string', description: 'File MIME type' },
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
