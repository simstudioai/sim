import { MicrosoftOneDriveIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { OneDriveResponse } from '@/tools/onedrive/types'

export const OneDriveBlock: BlockConfig<OneDriveResponse> = {
  type: 'onedrive',
  name: 'OneDrive',
  description: 'Create, upload, and list files',
  authMode: AuthMode.OAuth,
  longDescription: 'Integrate OneDrive into the workflow. Can create, upload, and list files.',
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
      layout: 'full',
      options: [
        { label: 'Create Folder', id: 'create_folder' },
        { label: 'Create File', id: 'create_file' },
        { label: 'Upload File', id: 'upload' },
        { label: 'List Files', id: 'list' },
      ],
    },
    // One Drive Credentials
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
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
      layout: 'full',
      placeholder: 'Name of the file',
      condition: { field: 'operation', value: 'upload' },
      mode: 'advanced',
      required: false,
    },
    // File upload (basic mode)
    {
      id: 'file',
      title: 'File',
      type: 'file-upload',
      layout: 'full',
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
      layout: 'full',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous block (e.g., {{block_1.file}})',
      condition: { field: 'operation', value: 'upload' },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'content',
      title: 'Text Content',
      title: 'Text Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Text content to upload (leave empty if uploading a file)',
      condition: { field: 'operation', value: 'upload' },
      required: false,
    },

    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      layout: 'full',
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
      layout: 'full',
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
      layout: 'full',
      placeholder: 'Name for the new folder',
      condition: { field: 'operation', value: 'create_folder' },
    },
    {
      id: 'folderSelector',
      title: 'Select Parent Folder',
      type: 'file-selector',
      layout: 'full',
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
      layout: 'full',
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
      layout: 'full',
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
      layout: 'full',
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
    access: ['onedrive_upload', 'onedrive_create_folder', 'onedrive_list'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_file':
          case 'upload':
            return 'onedrive_upload'
          case 'create_folder':
            return 'onedrive_create_folder'
          case 'list':
            return 'onedrive_list'
          default:
            throw new Error(`Invalid OneDrive operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, folderSelector, manualFolderId, mimeType, ...rest } = params

        // Use folderSelector if provided, otherwise use manualFolderId
        const effectiveFolderId = (folderSelector || manualFolderId || '').trim()

        return {
          credential,
          ...rest,
          folderId: effectiveFolderId || undefined,
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
    file: { type: 'json', description: 'File to upload (UserFile object)' },
    fileReference: { type: 'json', description: 'File reference from previous block' },
    content: { type: 'string', description: 'Text content to upload' },
    // Get Content operation inputs
    // fileId: { type: 'string', required: false },
    // List operation inputs
    folderSelector: { type: 'string', description: 'Folder selector' },
    manualFolderId: { type: 'string', description: 'Manual folder ID' },
    query: { type: 'string', description: 'Search query' },
    pageSize: { type: 'number', description: 'Results per page' },
  },
  outputs: {
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
