import { GoogleDriveIcon } from '@/components/icons'
import {
  GoogleDriveDownloadResponse,
  GoogleDriveListResponse,
  GoogleDriveUploadResponse,
} from '@/tools/google_drive/types'
import { BlockConfig } from '../types'

type GoogleDriveResponse =
  | GoogleDriveUploadResponse
  | GoogleDriveDownloadResponse
  | GoogleDriveListResponse

export const GoogleDriveBlock: BlockConfig<GoogleDriveResponse> = {
  type: 'google_drive',
  name: 'Google Drive',
  description: 'Upload, download, and list files',
  longDescription:
    'Integrate Google Drive functionality to manage files and folders. Upload new files, download existing ones, and list contents of folders using OAuth authentication. Supports file operations with custom MIME types and folder organization.',
  docsLink: 'https://docs.simstudio.ai/tools/google_drive',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleDriveIcon,
  subBlocks: [
    // Operation selector
    // {
    //   id: 'operation',
    //   title: 'Operation',
    //   type: 'dropdown',
    //   layout: 'full',
    //   options: [
    //     // { label: 'Upload File', id: 'upload' },
    //     // { label: 'Download File', id: 'download' },
    //     { label: 'List Files', id: 'list' },
    //   ],
    // },
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
      placeholder: 'Name for the uploaded file (e.g., document.txt)',
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
      type: 'short-input',
      layout: 'full',
      placeholder:
        'File MIME type (default: text/plain, e.g., text/plain, application/json, text/csv)',
      condition: { field: 'operation', value: 'upload' },
    },
    {
      id: 'folderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the parent folder (leave empty for root folder)',
      condition: { field: 'operation', value: 'upload' },
    },
    // Download Fields
    {
      id: 'fileId',
      title: 'File ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the file to download (find in file URL or by listing files)',
      condition: { field: 'operation', value: 'download' },
    },
    // List Fields - Folder Selector
    {
      id: 'folderId',
      title: 'Select Folder',
      type: 'file-selector',
      layout: 'full',
      provider: 'google-drive',
      serviceId: 'google-drive',
      requiredScopes: [],
      mimeType: 'application/vnd.google-apps.folder',
      placeholder: 'Select a folder',
      // condition: { field: 'operation', value: 'list' },
    },
    // Manual Folder ID input (shown only when no folder is selected)
    {
      id: 'folderId',
      title: 'Or Enter Folder ID Manually',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the folder to list (leave empty for root folder)',
      condition: {
        // field: 'operation',
        // value: 'list',
        // and: {
        field: 'folderId',
        value: '',
        // },
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Search for specific files (e.g., name contains "report")',
      // condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'pageSize',
      title: 'Results Per Page',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Number of results (default: 100, max: 1000)',
      // condition: { field: 'operation', value: 'list' },
    },
  ],
  tools: {
    access: ['google_drive_upload', 'google_drive_download', 'google_drive_list'],
    config: {
      tool: (params) => {
        // Since we only have 'list' now, we can simplify this
        return 'google_drive_list'

        // switch (params.operation) {
        //   case 'upload':
        //     return 'google_drive_upload'
        //   case 'download':
        //     return 'google_drive_download'
        //   case 'list':
        //     return 'google_drive_list'
        //   default:
        //     throw new Error(`Invalid Google Drive operation: ${params.operation}`)
        // }
      },
      params: (params) => {
        const { credential, folderId, ...rest } = params

        return {
          accessToken: credential,
          folderId: folderId?.trim() || '',
          pageSize: rest.pageSize ? parseInt(rest.pageSize as string, 10) : undefined,
          ...rest,
        }
      },
    },
  },
  inputs: {
    // operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    // Upload operation inputs
    fileName: { type: 'string', required: false },
    content: { type: 'string', required: false },
    mimeType: { type: 'string', required: false },
    // Download operation inputs
    fileId: { type: 'string', required: false },
    // List operation inputs
    folderId: { type: 'string', required: false },
    query: { type: 'string', required: false },
    pageSize: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        metadata: 'json',
      },
    },
  },
}
