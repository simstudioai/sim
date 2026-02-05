import { createLogger } from '@sim/logger'
import { MicrosoftOneDriveIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { OneDriveResponse } from '@/tools/onedrive/types'
import { normalizeExcelValuesForToolParams } from '@/tools/onedrive/utils'

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
      type: 'code',
      language: 'json',
      generationType: 'json-object',
      placeholder: 'Enter a JSON array of rows (e.g., [["A1","B1"],["A2","B2"]])',
      condition: {
        field: 'operation',
        value: 'create_file',
        and: {
          field: 'mimeType',
          value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of arrays that can be written directly into an Excel worksheet.',
        placeholder: 'Describe the table you want to generate...',
        generationType: 'json-object',
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
      id: 'uploadFolderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'uploadFolderId',
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
      id: 'uploadManualFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'uploadFolderId',
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
      id: 'createFolderParentSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      canonicalParamId: 'createFolderParentId',
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
      id: 'createFolderManualParentId',
      title: 'Parent Folder ID',
      type: 'short-input',
      canonicalParamId: 'createFolderParentId',
      placeholder: 'Enter parent folder ID (leave empty for root folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_folder' },
    },
    // List Fields - Folder Selector (basic mode)
    {
      id: 'listFolderSelector',
      title: 'Select Folder',
      type: 'file-selector',
      canonicalParamId: 'listFolderId',
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
      id: 'listManualFolderId',
      title: 'Folder ID',
      type: 'short-input',
      canonicalParamId: 'listFolderId',
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
      id: 'downloadFileSelector',
      title: 'Select File',
      type: 'file-selector',
      canonicalParamId: 'downloadFileId',
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
    {
      id: 'downloadFileName',
      title: 'File Name Override',
      type: 'short-input',
      placeholder: 'Optional: Override the filename',
      condition: { field: 'operation', value: 'download' },
    },
    // Delete File Fields - File Selector (basic mode)
    {
      id: 'deleteFileSelector',
      title: 'Select File to Delete',
      type: 'file-selector',
      canonicalParamId: 'deleteFileId',
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
      id: 'deleteManualFileId',
      title: 'File ID',
      type: 'short-input',
      canonicalParamId: 'deleteFileId',
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
        const {
          credential,
          // Folder canonical params (per-operation)
          uploadFolderId,
          createFolderParentId,
          listFolderId,
          // File canonical params (per-operation)
          downloadFileId,
          deleteFileId,
          mimeType,
          values,
          downloadFileName,
          file,
          ...rest
        } = params

        let normalizedValues: ReturnType<typeof normalizeExcelValuesForToolParams>
        if (values !== undefined) {
          normalizedValues = normalizeExcelValuesForToolParams(values)
        }

        // Normalize file input from the canonical param
        const normalizedFile = normalizeFileInput(file, { single: true })

        // Resolve folderId based on operation
        let resolvedFolderId: string | undefined
        switch (params.operation) {
          case 'create_file':
          case 'upload':
            resolvedFolderId = uploadFolderId?.trim() || undefined
            break
          case 'create_folder':
            resolvedFolderId = createFolderParentId?.trim() || undefined
            break
          case 'list':
            resolvedFolderId = listFolderId?.trim() || undefined
            break
        }

        // Resolve fileId based on operation
        let resolvedFileId: string | undefined
        switch (params.operation) {
          case 'download':
            resolvedFileId = downloadFileId?.trim() || undefined
            break
          case 'delete':
            resolvedFileId = deleteFileId?.trim() || undefined
            break
        }

        return {
          credential,
          ...rest,
          values: normalizedValues,
          file: normalizedFile,
          folderId: resolvedFolderId,
          fileId: resolvedFileId,
          pageSize: rest.pageSize ? Number.parseInt(rest.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...(downloadFileName && { fileName: downloadFileName }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft account credential' },
    // Upload and Create operation inputs
    fileName: { type: 'string', description: 'File name' },
    file: { type: 'json', description: 'File to upload (UserFile object)' },
    content: { type: 'string', description: 'Text content to upload' },
    mimeType: { type: 'string', description: 'MIME type of file to create' },
    values: { type: 'json', description: 'Cell values for new Excel as JSON' },
    // Folder canonical params (per-operation)
    uploadFolderId: { type: 'string', description: 'Parent folder for upload/create file' },
    createFolderParentId: { type: 'string', description: 'Parent folder for create folder' },
    listFolderId: { type: 'string', description: 'Folder to list files from' },
    // File canonical params (per-operation)
    downloadFileId: { type: 'string', description: 'File to download' },
    deleteFileId: { type: 'string', description: 'File to delete' },
    downloadFileName: { type: 'string', description: 'File name override for download' },
    folderName: { type: 'string', description: 'Folder name for create_folder' },
    // List operation inputs
    query: { type: 'string', description: 'Search query' },
    pageSize: { type: 'number', description: 'Results per page' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    deleted: { type: 'boolean', description: 'Whether the file was deleted' },
    fileId: { type: 'string', description: 'The ID of the deleted file' },
    file: {
      type: 'file',
      description: 'The OneDrive file object, including details such as id, name, size, and more.',
    },
    files: {
      type: 'json',
      description:
        'An array of OneDrive file objects, each containing details such as id, name, size, and more.',
    },
  },
}
