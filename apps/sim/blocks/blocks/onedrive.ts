import { MicrosoftOneDriveIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { OneDriveResponse } from '@/tools/onedrive/types'

const logger = createLogger('OneDriveBlock')

export const OneDriveBlock: BlockConfig<OneDriveResponse> = {
  type: 'onedrive',
  name: 'OneDrive',
  description: 'Create, upload, download, list, and delete files',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate OneDrive into the workflow. Can create text and Excel files, upload files, download files, list files, and delete files or folders.',
  docsLink: 'https://docs.sim.ai/tools/onedrive',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftOneDriveIcon,
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
        { label: 'Delete File', id: 'delete' },
      ],
    },
    // One Drive Credentials
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      provider: 'onedrive',
      serviceId: 'onedrive',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
    },
    // Create File Fields
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Name of the file',
      condition: { field: 'operation', value: ['create_file', 'upload'] },
      required: true,
    },
    // File Type selector for create_file operation
    {
      id: 'mimeType',
      title: 'File Type',
      type: 'dropdown',
      options: [
        { label: 'Text File (.txt)', id: 'text/plain' },
        {
          label: 'Excel File (.xlsx)',
          id: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
      placeholder: 'Select file type',
      condition: { field: 'operation', value: 'create_file' },
      required: true,
    },
    // Excel values input when creating an .xlsx file
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder:
        'Enter values as JSON array of arrays (e.g., [["A1","B1"],["A2","B2"]]) or an array of objects',
      condition: {
        field: 'operation',
        value: 'create_file',
        and: {
          field: 'mimeType',
          value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      },
      required: false,
    },
    // File upload (basic mode)
    {
      id: 'file',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file',
      condition: { field: 'operation', value: 'upload' },
      mode: 'basic',
      multiple: false,
      required: false,
    },
    // Variable reference (advanced mode)
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous block (e.g., {{block_1.file}})',
      condition: { field: 'operation', value: 'upload' },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'content',
      title: 'Text Content',
      type: 'long-input',
      placeholder: 'Text content for the file',
      condition: {
        field: 'operation',
        value: 'create_file',
        and: {
          field: 'mimeType',
          value: 'text/plain',
        },
      },
      required: true,
    },

    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      provider: 'microsoft',
      serviceId: 'onedrive',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a parent folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['create_file', 'upload'] },
    },
    {
      id: 'manualFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'folderId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_file', 'upload'] },
    },
    {
      id: 'folderName',
      title: 'Folder Name',
      type: 'short-input',
      placeholder: 'Name for the new folder',
      condition: { field: 'operation', value: 'create_folder' },
    },
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      provider: 'microsoft',
      serviceId: 'onedrive',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a parent folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'create_folder' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'manualFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'folderId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_folder' },
    },
    // List Fields - Folder Selector (basic mode)
    {
      id: 'folderSelector',
      title: 'Select Folder',
      type: 'file-selector',
      canonicalParamId: 'folderId',
      provider: 'microsoft',
      serviceId: 'onedrive',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a folder to list files from',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'list' },
    },
    // Manual Folder ID input (advanced mode)
    {
      id: 'manualFolderId',
      title: 'Folder ID',
      type: 'short-input',
      canonicalParamId: 'folderId',
      placeholder: 'Enter folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
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
      provider: 'microsoft',
      serviceId: 'onedrive',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      mimeType: 'file', // Exclude folders, show only files
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
    {
      id: 'downloadFileName',
      title: 'File Name Override',
      type: 'short-input',
      canonicalParamId: 'fileName',
      placeholder: 'Optional: Override the filename',
      condition: { field: 'operation', value: 'download' },
    },
    // Delete File Fields - File Selector (basic mode)
    {
      id: 'fileSelector',
      title: 'Select File to Delete',
      type: 'file-selector',
      canonicalParamId: 'fileId',
      provider: 'microsoft',
      serviceId: 'onedrive',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      mimeType: 'file', // Exclude folders, show only files
      placeholder: 'Select a file to delete',
      mode: 'basic',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
    // Manual File ID input (advanced mode)
    {
      id: 'manualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'fileId',
      placeholder: 'Enter file or folder ID to delete',
      mode: 'advanced',
      condition: { field: 'operation', value: 'delete' },
      required: true,
    },
  ],
  tools: {
    access: [
      'onedrive_upload',
      'onedrive_create_folder',
      'onedrive_download',
      'onedrive_list',
      'onedrive_delete',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_file':
          case 'upload':
            return 'onedrive_upload'
          case 'create_folder':
            return 'onedrive_create_folder'
          case 'download':
            return 'onedrive_download'
          case 'list':
            return 'onedrive_list'
          case 'delete':
            return 'onedrive_delete'
          default:
            throw new Error(`Invalid OneDrive operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, folderId, fileId, mimeType, values, ...rest } = params

        let parsedValues
        try {
          parsedValues = values ? JSON.parse(values as string) : undefined
        } catch (error) {
          throw new Error('Invalid JSON format for values')
        }

        return {
          credential,
          ...rest,
          values: parsedValues,
          folderId: folderId || undefined,
          fileId: fileId || undefined,
          pageSize: rest.pageSize ? Number.parseInt(rest.pageSize as string, 10) : undefined,
          mimeType: mimeType,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft account credential' },
    // Upload and Create Folder operation inputs
    fileName: { type: 'string', description: 'File name' },
    file: { type: 'json', description: 'File to upload (UserFile object)' },
    fileReference: { type: 'json', description: 'File reference from previous block' },
    content: { type: 'string', description: 'Text content to upload' },
    mimeType: { type: 'string', description: 'MIME type of file to create' },
    values: { type: 'string', description: 'Cell values for new Excel as JSON' },
    fileId: { type: 'string', description: 'File ID to download' },
    downloadFileName: { type: 'string', description: 'File name override for download' },
    folderId: { type: 'string', description: 'Folder ID' },
    query: { type: 'string', description: 'Search query' },
    pageSize: { type: 'number', description: 'Results per page' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    deleted: { type: 'boolean', description: 'Whether the file was deleted' },
    fileId: { type: 'string', description: 'The ID of the deleted file' },
    file: {
      type: 'json',
      description: 'The OneDrive file object, including details such as id, name, size, and more.',
    },
    files: {
      type: 'json',
      description:
        'An array of OneDrive file objects, each containing details such as id, name, size, and more.',
    },
  },
}
