import { BoxCompanyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { BoxResponse } from '@/tools/box/types'

export const BoxBlock: BlockConfig<BoxResponse> = {
  type: 'box',
  name: 'Box',
  description: 'Manage files and folders in Box cloud storage',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Box into the workflow. Can manage files and folders, search content, create shared links, and collaborate with users. Supports file operations like copy, move, delete, and download.',
  docsLink: 'https://docs.sim.ai/tools/box',
  category: 'tools',
  icon: BoxCompanyIcon,
  bgColor: '#0061D5',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // File Operations
        { label: 'Get File Info', id: 'box_get_file', group: 'Files' },
        { label: 'Download File', id: 'box_download_file', group: 'Files' },
        { label: 'Update File', id: 'box_update_file', group: 'Files' },
        { label: 'Copy File', id: 'box_copy_file', group: 'Files' },
        { label: 'Delete File', id: 'box_delete_file', group: 'Files' },
        // Folder Operations
        { label: 'List Folder', id: 'box_list_folder', group: 'Folders' },
        { label: 'Create Folder', id: 'box_create_folder', group: 'Folders' },
        { label: 'Delete Folder', id: 'box_delete_folder', group: 'Folders' },
        // Search
        { label: 'Search', id: 'box_search', group: 'Search' },
        // Sharing
        { label: 'Create Shared Link', id: 'box_create_shared_link', group: 'Sharing' },
        { label: 'Create Collaboration', id: 'box_create_collaboration', group: 'Sharing' },
        // User
        { label: 'Get Current User', id: 'box_get_current_user', group: 'User' },
      ],
      grouped: true,
    },
    // OAuth Credential
    {
      id: 'credential',
      title: 'Box Account',
      type: 'oauth-input',
      serviceId: 'box',
      requiredScopes: ['root_readwrite'],
      placeholder: 'Select Box account',
      required: true,
    },
    // File ID input (for file operations)
    {
      id: 'fileId',
      title: 'File ID',
      type: 'short-input',
      placeholder: 'Enter file ID',
      condition: {
        field: 'operation',
        value: [
          'box_get_file',
          'box_download_file',
          'box_update_file',
          'box_copy_file',
          'box_delete_file',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'box_get_file',
          'box_download_file',
          'box_update_file',
          'box_copy_file',
          'box_delete_file',
        ],
      },
    },
    // Folder ID input (for folder operations)
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Enter folder ID (0 for root)',
      condition: {
        field: 'operation',
        value: ['box_list_folder', 'box_delete_folder'],
      },
      required: {
        field: 'operation',
        value: ['box_list_folder', 'box_delete_folder'],
      },
    },
    // Parent Folder ID (for create folder and copy)
    {
      id: 'parentFolderId',
      title: 'Parent Folder ID',
      type: 'short-input',
      placeholder: 'Enter parent folder ID (0 for root)',
      condition: {
        field: 'operation',
        value: ['box_create_folder', 'box_copy_file'],
      },
      required: {
        field: 'operation',
        value: ['box_create_folder', 'box_copy_file'],
      },
    },
    // Folder Name (for create folder)
    {
      id: 'folderName',
      title: 'Folder Name',
      type: 'short-input',
      placeholder: 'Enter folder name',
      condition: { field: 'operation', value: 'box_create_folder' },
      required: { field: 'operation', value: 'box_create_folder' },
    },
    // New Name (for update file and copy)
    {
      id: 'name',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'Enter new name (optional)',
      condition: {
        field: 'operation',
        value: ['box_update_file', 'box_copy_file'],
      },
    },
    // Description (for update file)
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter description (optional)',
      condition: { field: 'operation', value: 'box_update_file' },
    },
    // Parent ID for move (update file)
    {
      id: 'parentId',
      title: 'Move to Folder ID',
      type: 'short-input',
      placeholder: 'Enter destination folder ID to move file',
      condition: { field: 'operation', value: 'box_update_file' },
    },
    // Tags (for update file)
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags (optional)',
      condition: { field: 'operation', value: 'box_update_file' },
    },
    // Search Query
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search query',
      condition: { field: 'operation', value: 'box_search' },
      required: { field: 'operation', value: 'box_search' },
    },
    // Search Scope
    {
      id: 'scope',
      title: 'Search Scope',
      type: 'dropdown',
      options: [
        { label: 'User Content', id: 'user_content' },
        { label: 'Enterprise Content', id: 'enterprise_content' },
      ],
      condition: { field: 'operation', value: 'box_search' },
    },
    // File Extensions filter
    {
      id: 'fileExtensions',
      title: 'File Extensions',
      type: 'short-input',
      placeholder: 'e.g., pdf,docx,xlsx',
      condition: { field: 'operation', value: 'box_search' },
    },
    // Limit
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (default: 30)',
      condition: {
        field: 'operation',
        value: ['box_list_folder', 'box_search'],
      },
    },
    // Offset
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Offset for pagination',
      condition: {
        field: 'operation',
        value: ['box_list_folder', 'box_search'],
      },
    },
    // Recursive delete (for folder)
    {
      id: 'recursive',
      title: 'Delete Contents',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: 'box_delete_folder' },
    },
    // Permanent delete (for file)
    {
      id: 'permanent',
      title: 'Permanent Delete',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'box_delete_file' },
    },
    // Shared Link - Item ID
    {
      id: 'itemId',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'Enter file or folder ID',
      condition: {
        field: 'operation',
        value: ['box_create_shared_link', 'box_create_collaboration'],
      },
      required: {
        field: 'operation',
        value: ['box_create_shared_link', 'box_create_collaboration'],
      },
    },
    // Item Type (for shared link and collaboration)
    {
      id: 'itemType',
      title: 'Item Type',
      type: 'dropdown',
      options: [
        { label: 'File', id: 'file' },
        { label: 'Folder', id: 'folder' },
      ],
      condition: {
        field: 'operation',
        value: ['box_create_shared_link', 'box_create_collaboration'],
      },
      required: {
        field: 'operation',
        value: ['box_create_shared_link', 'box_create_collaboration'],
      },
    },
    // Shared Link Access Level
    {
      id: 'access',
      title: 'Access Level',
      type: 'dropdown',
      options: [
        { label: 'Open (Anyone with link)', id: 'open' },
        { label: 'Company (Only company members)', id: 'company' },
        { label: 'Collaborators Only', id: 'collaborators' },
      ],
      condition: { field: 'operation', value: 'box_create_shared_link' },
    },
    // Shared Link Password
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Optional password protection',
      password: true,
      condition: { field: 'operation', value: 'box_create_shared_link' },
    },
    // Shared Link Expiration
    {
      id: 'unsharedAt',
      title: 'Expiration Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2024-12-31)',
      condition: { field: 'operation', value: 'box_create_shared_link' },
    },
    // Can Download
    {
      id: 'canDownload',
      title: 'Allow Download',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: 'box_create_shared_link' },
    },
    // Can Preview
    {
      id: 'canPreview',
      title: 'Allow Preview',
      type: 'switch',
      defaultValue: true,
      condition: { field: 'operation', value: 'box_create_shared_link' },
    },
    // Collaboration - Email
    {
      id: 'accessibleByLogin',
      title: 'User Email',
      type: 'short-input',
      placeholder: 'Enter user email to share with',
      condition: { field: 'operation', value: 'box_create_collaboration' },
    },
    // Collaboration - Type
    {
      id: 'accessibleByType',
      title: 'Collaborator Type',
      type: 'dropdown',
      options: [
        { label: 'User', id: 'user' },
        { label: 'Group', id: 'group' },
      ],
      condition: { field: 'operation', value: 'box_create_collaboration' },
      required: { field: 'operation', value: 'box_create_collaboration' },
    },
    // Collaboration - Role
    {
      id: 'role',
      title: 'Role',
      type: 'dropdown',
      options: [
        { label: 'Editor', id: 'editor' },
        { label: 'Viewer', id: 'viewer' },
        { label: 'Previewer', id: 'previewer' },
        { label: 'Uploader', id: 'uploader' },
        { label: 'Co-Owner', id: 'co-owner' },
      ],
      condition: { field: 'operation', value: 'box_create_collaboration' },
      required: { field: 'operation', value: 'box_create_collaboration' },
    },
  ],
  tools: {
    access: [
      'box_get_file',
      'box_list_folder',
      'box_create_folder',
      'box_delete_file',
      'box_delete_folder',
      'box_copy_file',
      'box_update_file',
      'box_search',
      'box_download_file',
      'box_get_current_user',
      'box_create_shared_link',
      'box_create_collaboration',
    ],
    config: {
      tool: (params) => params.operation || 'box_list_folder',
      params: (params) => {
        const baseParams: Record<string, unknown> = {}

        switch (params.operation) {
          case 'box_get_file':
          case 'box_download_file':
            return { fileId: params.fileId }

          case 'box_update_file':
            return {
              fileId: params.fileId,
              name: params.name || undefined,
              description: params.description || undefined,
              parentId: params.parentId || undefined,
              tags: params.tags ? params.tags.split(',').map((t: string) => t.trim()) : undefined,
            }

          case 'box_copy_file':
            return {
              fileId: params.fileId,
              parentFolderId: params.parentFolderId,
              newName: params.name || undefined,
            }

          case 'box_delete_file':
            return {
              fileId: params.fileId,
              permanent: params.permanent || false,
            }

          case 'box_list_folder':
            return {
              folderId: params.folderId || '0',
              limit: params.limit ? Number(params.limit) : undefined,
              offset: params.offset ? Number(params.offset) : undefined,
            }

          case 'box_create_folder':
            return {
              parentFolderId: params.parentFolderId || '0',
              folderName: params.folderName,
            }

          case 'box_delete_folder':
            return {
              folderId: params.folderId,
              recursive: params.recursive !== false,
            }

          case 'box_search':
            return {
              query: params.query,
              scope: params.scope || undefined,
              fileExtensions: params.fileExtensions || undefined,
              limit: params.limit ? Number(params.limit) : undefined,
              offset: params.offset ? Number(params.offset) : undefined,
            }

          case 'box_get_current_user':
            return {}

          case 'box_create_shared_link':
            return {
              itemId: params.itemId,
              itemType: params.itemType,
              access: params.access || undefined,
              password: params.password || undefined,
              unsharedAt: params.unsharedAt || undefined,
              canDownload: params.canDownload,
              canPreview: params.canPreview,
            }

          case 'box_create_collaboration':
            return {
              itemId: params.itemId,
              itemType: params.itemType,
              accessibleByLogin: params.accessibleByLogin || undefined,
              accessibleByType: params.accessibleByType,
              role: params.role,
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'The Box operation to perform' },
    credential: { type: 'string', description: 'Box OAuth credential' },
    fileId: { type: 'string', description: 'File ID' },
    folderId: { type: 'string', description: 'Folder ID' },
    parentFolderId: { type: 'string', description: 'Parent folder ID' },
    folderName: { type: 'string', description: 'Folder name' },
    name: { type: 'string', description: 'New name for file/folder' },
    description: { type: 'string', description: 'Description' },
    parentId: { type: 'string', description: 'Destination folder ID for move' },
    query: { type: 'string', description: 'Search query' },
    scope: { type: 'string', description: 'Search scope' },
    fileExtensions: { type: 'string', description: 'File extensions filter' },
    limit: { type: 'number', description: 'Maximum results' },
    offset: { type: 'number', description: 'Pagination offset' },
    recursive: { type: 'boolean', description: 'Delete folder contents recursively' },
    permanent: { type: 'boolean', description: 'Permanently delete file' },
    itemId: { type: 'string', description: 'Item ID for sharing' },
    itemType: { type: 'string', description: 'Item type (file or folder)' },
    access: { type: 'string', description: 'Shared link access level' },
    password: { type: 'string', description: 'Shared link password' },
    unsharedAt: { type: 'string', description: 'Shared link expiration date' },
    canDownload: { type: 'boolean', description: 'Allow download via shared link' },
    canPreview: { type: 'boolean', description: 'Allow preview via shared link' },
    tags: { type: 'string', description: 'Comma-separated tags for file' },
    accessibleByLogin: { type: 'string', description: 'Email of user to share with' },
    accessibleByType: { type: 'string', description: 'Type of collaborator' },
    role: { type: 'string', description: 'Collaboration role' },
  },
  outputs: {
    file: {
      type: 'json',
      description: 'File information',
    },
    folder: {
      type: 'json',
      description: 'Folder information',
    },
    items: {
      type: 'json',
      description: 'List of files and folders',
    },
    results: {
      type: 'json',
      description: 'Search results',
    },
    sharedLink: {
      type: 'json',
      description: 'Shared link information',
    },
    collaboration: {
      type: 'json',
      description: 'Collaboration information',
    },
    user: {
      type: 'json',
      description: 'User information',
    },
    success: {
      type: 'boolean',
      description: 'Whether the operation was successful',
    },
    totalCount: {
      type: 'number',
      description: 'Total count of items',
    },
    downloadUrl: {
      type: 'string',
      description: 'Download URL for file',
    },
    content: {
      type: 'string',
      description: 'File content (for text files)',
    },
  },
}
