import { GoogleDriveIcon } from '@/components/icons'
import {
  GoogleDriveGetContentResponse,
  GoogleDriveListResponse,
  GoogleDriveUploadResponse,
} from '@/tools/google_drive/types'
import { BlockConfig } from '../types'

type GoogleDriveResponse =
  | GoogleDriveUploadResponse
  | GoogleDriveGetContentResponse
  | GoogleDriveListResponse

export const GoogleDriveBlock: BlockConfig<GoogleDriveResponse> = {
  type: 'google_drive',
  name: 'Google Drive',
  description: 'Create, upload, and list files',
  longDescription:
    'Integrate Google Drive functionality to manage files and folders. Upload new files, get content from existing files, create new folders, and list contents of folders using OAuth authentication. Supports file operations with custom MIME types and folder organization.',
  docsLink: 'https://docs.simstudio.ai/tools/google_drive',
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
        // { label: 'Get File Content', id: 'get_content' },
        { label: 'List Files', id: 'list' },
      ],
    },
    // Google Drive Credentials
    {
      id: 'credential',
      title: 'Google Drive Account',
      type: 'oauth-input',
      layout: 'full',
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
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Content to upload to the file',
      condition: { field: 'operation', value: 'upload' },
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
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      condition: { field: 'operation', value: 'upload' },
    },
    {
      id: 'folderId',
      title: 'Or Enter Parent Folder ID Manually',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the parent folder (leave empty for root folder)',
      condition: {
        field: 'operation',
        value: 'upload',
      },
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
    },
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      layout: 'full',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a parent folder',
      condition: { field: 'operation', value: 'create_folder' },
    },
    // Manual Folder ID input (shown only when no folder is selected)
    {
      id: 'folderId',
      title: 'Or Enter Parent Folder ID Manually',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the parent folder (leave empty for root folder)',
      condition: {
        field: 'operation',
        value: 'create_folder',
      },
    },
    // List Fields - Folder Selector
    {
      id: 'folderSelector',
      title: 'Select Folder',
      type: 'file-selector',
      layout: 'full',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a folder to list files from',
      condition: { field: 'operation', value: 'list' },
    },
    // Manual Folder ID input (shown only when no folder is selected)
    {
      id: 'folderId',
      title: 'Or Enter Folder ID Manually',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the folder to list (leave empty for root folder)',
      condition: {
        field: 'operation',
        value: 'list',
      },
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
          // case 'get_content':
          //   return 'google_drive_get_content'
          case 'create_folder':
            return 'google_drive_create_folder'
          case 'list':
            return 'google_drive_list'
          default:
            throw new Error(`Invalid Google Drive operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, folderId, folderSelector, mimeType, ...rest } = params

        // Use folderSelector if provided, otherwise use folderId
        const effectiveFolderId = folderSelector || folderId || ''

        return {
          accessToken: credential,
          folderId: effectiveFolderId.trim(),
          pageSize: rest.pageSize ? parseInt(rest.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    // Upload and Create Folder operation inputs
    fileName: { type: 'string', required: false },
    content: { type: 'string', required: false },
    mimeType: { type: 'string', required: false },
    // Get Content operation inputs
    // fileId: { type: 'string', required: false },
    // List operation inputs
    folderId: { type: 'string', required: false },
    folderSelector: { type: 'string', required: false },
    query: { type: 'string', required: false },
    pageSize: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        file: 'json',
        files: 'json',
      },
    },
  },
}
