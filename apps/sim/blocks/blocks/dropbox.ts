import { DropboxIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { DropboxResponse } from '@/tools/dropbox/types'

export const DropboxBlock: BlockConfig<DropboxResponse> = {
  type: 'dropbox',
  name: 'Dropbox',
  description: 'Upload, download, share, and manage files in Dropbox',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Dropbox into your workflow for file management, sharing, and collaboration. Upload files, download content, create folders, manage shared links, and more.',
  docsLink: 'https://docs.sim.ai/tools/dropbox',
  category: 'tools',
  icon: DropboxIcon,
  bgColor: '#0061FF',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Upload File', id: 'dropbox_upload' },
        { label: 'Download File', id: 'dropbox_download' },
        { label: 'List Folder', id: 'dropbox_list_folder' },
        { label: 'Create Folder', id: 'dropbox_create_folder' },
        { label: 'Delete File/Folder', id: 'dropbox_delete' },
        { label: 'Copy File/Folder', id: 'dropbox_copy' },
        { label: 'Move File/Folder', id: 'dropbox_move' },
        { label: 'Get Metadata', id: 'dropbox_get_metadata' },
        { label: 'Create Shared Link', id: 'dropbox_create_shared_link' },
        { label: 'Search Files', id: 'dropbox_search' },
      ],
      value: () => 'dropbox_upload',
    },
    {
      id: 'credential',
      title: 'Dropbox Account',
      type: 'oauth-input',
      serviceId: 'dropbox',
      requiredScopes: [
        'account_info.read',
        'files.metadata.read',
        'files.metadata.write',
        'files.content.read',
        'files.content.write',
        'sharing.read',
        'sharing.write',
      ],
      placeholder: 'Select Dropbox account',
      required: true,
    },
    // Upload operation inputs
    {
      id: 'path',
      title: 'Destination Path',
      type: 'short-input',
      placeholder: '/folder/document.pdf',
      condition: { field: 'operation', value: 'dropbox_upload' },
      required: true,
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload file to send to Dropbox',
      mode: 'basic',
      multiple: false,
      required: true,
      condition: { field: 'operation', value: 'dropbox_upload' },
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous blocks',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'dropbox_upload' },
    },
    {
      id: 'mode',
      title: 'Write Mode',
      type: 'dropdown',
      options: [
        { label: 'Add (create new)', id: 'add' },
        { label: 'Overwrite (replace existing)', id: 'overwrite' },
      ],
      value: () => 'add',
      condition: { field: 'operation', value: 'dropbox_upload' },
    },
    {
      id: 'autorename',
      title: 'Auto-rename on Conflict',
      type: 'switch',
      condition: { field: 'operation', value: 'dropbox_upload' },
    },
    // Download operation inputs
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: '/folder/document.pdf',
      condition: { field: 'operation', value: 'dropbox_download' },
      required: true,
    },
    // List folder operation inputs
    {
      id: 'path',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: '/ (root) or /folder',
      condition: { field: 'operation', value: 'dropbox_list_folder' },
      required: true,
    },
    {
      id: 'recursive',
      title: 'List Recursively',
      type: 'switch',
      condition: { field: 'operation', value: 'dropbox_list_folder' },
    },
    {
      id: 'limit',
      title: 'Maximum Results',
      type: 'short-input',
      placeholder: '500',
      condition: { field: 'operation', value: 'dropbox_list_folder' },
    },
    // Create folder operation inputs
    {
      id: 'path',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: '/new-folder',
      condition: { field: 'operation', value: 'dropbox_create_folder' },
      required: true,
    },
    {
      id: 'autorename',
      title: 'Auto-rename on Conflict',
      type: 'switch',
      condition: { field: 'operation', value: 'dropbox_create_folder' },
    },
    // Delete operation inputs
    {
      id: 'path',
      title: 'Path to Delete',
      type: 'short-input',
      placeholder: '/folder/file.txt',
      condition: { field: 'operation', value: 'dropbox_delete' },
      required: true,
    },
    // Copy operation inputs
    {
      id: 'fromPath',
      title: 'Source Path',
      type: 'short-input',
      placeholder: '/source/document.pdf',
      condition: { field: 'operation', value: 'dropbox_copy' },
      required: true,
    },
    {
      id: 'toPath',
      title: 'Destination Path',
      type: 'short-input',
      placeholder: '/destination/document.pdf',
      condition: { field: 'operation', value: 'dropbox_copy' },
      required: true,
    },
    {
      id: 'autorename',
      title: 'Auto-rename on Conflict',
      type: 'switch',
      condition: { field: 'operation', value: 'dropbox_copy' },
    },
    // Move operation inputs
    {
      id: 'fromPath',
      title: 'Source Path',
      type: 'short-input',
      placeholder: '/old-location/document.pdf',
      condition: { field: 'operation', value: 'dropbox_move' },
      required: true,
    },
    {
      id: 'toPath',
      title: 'Destination Path',
      type: 'short-input',
      placeholder: '/new-location/document.pdf',
      condition: { field: 'operation', value: 'dropbox_move' },
      required: true,
    },
    {
      id: 'autorename',
      title: 'Auto-rename on Conflict',
      type: 'switch',
      condition: { field: 'operation', value: 'dropbox_move' },
    },
    // Get metadata operation inputs
    {
      id: 'path',
      title: 'File/Folder Path',
      type: 'short-input',
      placeholder: '/folder/document.pdf',
      condition: { field: 'operation', value: 'dropbox_get_metadata' },
      required: true,
    },
    {
      id: 'includeMediaInfo',
      title: 'Include Media Info',
      type: 'switch',
      condition: { field: 'operation', value: 'dropbox_get_metadata' },
    },
    // Create shared link operation inputs
    {
      id: 'path',
      title: 'File/Folder Path',
      type: 'short-input',
      placeholder: '/folder/document.pdf',
      condition: { field: 'operation', value: 'dropbox_create_shared_link' },
      required: true,
    },
    {
      id: 'requestedVisibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Public (anyone with link)', id: 'public' },
        { label: 'Team Only', id: 'team_only' },
        { label: 'Password Protected', id: 'password' },
      ],
      value: () => 'public',
      condition: { field: 'operation', value: 'dropbox_create_shared_link' },
    },
    {
      id: 'linkPassword',
      title: 'Link Password',
      type: 'short-input',
      placeholder: 'Enter password for the link',
      password: true,
      condition: { field: 'operation', value: 'dropbox_create_shared_link' },
    },
    {
      id: 'expires',
      title: 'Expiration Date',
      type: 'short-input',
      placeholder: '2025-12-31T23:59:59Z',
      condition: { field: 'operation', value: 'dropbox_create_shared_link' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "in 1 week" -> Calculate 7 days from now at 23:59:59Z
- "end of month" -> Calculate last day of current month at 23:59:59Z
- "next year" -> Calculate January 1st of next year at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when link should expire (e.g., "in 1 week", "end of month")...',
        generationType: 'timestamp',
      },
    },
    // Search operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search term...',
      condition: { field: 'operation', value: 'dropbox_search' },
      required: true,
    },
    {
      id: 'path',
      title: 'Search in Folder',
      type: 'short-input',
      placeholder: '/ (search all) or /folder',
      condition: { field: 'operation', value: 'dropbox_search' },
    },
    {
      id: 'fileExtensions',
      title: 'File Extensions',
      type: 'short-input',
      placeholder: 'pdf,xlsx,docx (comma-separated)',
      condition: { field: 'operation', value: 'dropbox_search' },
    },
    {
      id: 'maxResults',
      title: 'Maximum Results',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'dropbox_search' },
    },
  ],
  tools: {
    access: [
      'dropbox_upload',
      'dropbox_download',
      'dropbox_list_folder',
      'dropbox_create_folder',
      'dropbox_delete',
      'dropbox_copy',
      'dropbox_move',
      'dropbox_get_metadata',
      'dropbox_create_shared_link',
      'dropbox_search',
    ],
    config: {
      tool: (params) => {
        // Convert numeric params
        if (params.limit) {
          params.limit = Number(params.limit)
        }
        if (params.maxResults) {
          params.maxResults = Number(params.maxResults)
        }

        // Normalize file input for upload operation - use canonical 'file' param
        const normalizedFile = normalizeFileInput(params.file, { single: true })
        if (normalizedFile) {
          params.file = normalizedFile
        }

        switch (params.operation) {
          case 'dropbox_upload':
            return 'dropbox_upload'
          case 'dropbox_download':
            return 'dropbox_download'
          case 'dropbox_list_folder':
            return 'dropbox_list_folder'
          case 'dropbox_create_folder':
            return 'dropbox_create_folder'
          case 'dropbox_delete':
            return 'dropbox_delete'
          case 'dropbox_copy':
            return 'dropbox_copy'
          case 'dropbox_move':
            return 'dropbox_move'
          case 'dropbox_get_metadata':
            return 'dropbox_get_metadata'
          case 'dropbox_create_shared_link':
            return 'dropbox_create_shared_link'
          case 'dropbox_search':
            return 'dropbox_search'
          default:
            return 'dropbox_upload'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Dropbox OAuth credential' },
    // Common inputs
    path: { type: 'string', description: 'Path in Dropbox' },
    autorename: { type: 'boolean', description: 'Auto-rename on conflict' },
    // Upload inputs
    file: { type: 'json', description: 'File to upload (canonical param)' },
    fileName: { type: 'string', description: 'Optional filename' },
    mode: { type: 'string', description: 'Write mode: add or overwrite' },
    mute: { type: 'boolean', description: 'Mute notifications' },
    // List folder inputs
    recursive: { type: 'boolean', description: 'List recursively' },
    includeDeleted: { type: 'boolean', description: 'Include deleted files' },
    includeMediaInfo: { type: 'boolean', description: 'Include media info' },
    limit: { type: 'number', description: 'Maximum results' },
    // Copy/Move inputs
    fromPath: { type: 'string', description: 'Source path' },
    toPath: { type: 'string', description: 'Destination path' },
    // Shared link inputs
    requestedVisibility: { type: 'string', description: 'Link visibility' },
    linkPassword: { type: 'string', description: 'Password for the link' },
    expires: { type: 'string', description: 'Expiration date (ISO 8601)' },
    // Search inputs
    query: { type: 'string', description: 'Search query' },
    fileExtensions: { type: 'string', description: 'File extensions filter' },
    maxResults: { type: 'number', description: 'Maximum search results' },
  },
  outputs: {
    // Upload/Download outputs
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    content: { type: 'string', description: 'File content (base64)' },
    temporaryLink: { type: 'string', description: 'Temporary download link' },
    // List folder outputs
    entries: { type: 'json', description: 'List of files and folders' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    hasMore: { type: 'boolean', description: 'Whether more results exist' },
    // Create folder output
    folder: { type: 'json', description: 'Created folder metadata' },
    // Delete output
    deleted: { type: 'boolean', description: 'Whether deletion was successful' },
    // Copy/Move/Get metadata output
    metadata: { type: 'json', description: 'Item metadata' },
    // Shared link output
    sharedLink: { type: 'json', description: 'Shared link details' },
    // Search outputs
    matches: { type: 'json', description: 'Search results' },
  },
}
