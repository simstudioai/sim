import { DropboxIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { DropboxBlockDisplay } from '@/blocks/blocks/dropbox.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { DropboxResponse } from '@/tools/dropbox/types'

export const DropboxBlock: BlockConfig<DropboxResponse> = {
  ...DropboxBlockDisplay,
  authMode: AuthMode.OAuth,
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'dropbox',
      requiredScopes: getScopesForService('dropbox'),
      placeholder: 'Select Dropbox account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Dropbox Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
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
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.limit) result.limit = Number(params.limit)
        if (params.maxResults) result.maxResults = Number(params.maxResults)
        const normalizedFile = normalizeFileInput(params.file, { single: true })
        if (normalizedFile) {
          result.file = normalizedFile
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Dropbox OAuth credential' },
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

export const DropboxBlockMeta = {
  tags: ['cloud', 'document-processing'],
  url: 'https://www.dropbox.com',
  templates: [
    {
      icon: DropboxIcon,
      title: 'Dropbox to knowledge base',
      prompt:
        'Build a scheduled workflow that lists a Dropbox folder, downloads documents added since the last run, extracts and chunks their text, and upserts the chunks into a knowledge base for agent retrieval.',
      modules: ['scheduled', 'knowledge-base', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sync'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox shared-link auditor',
      prompt:
        'Create a scheduled workflow that lists Dropbox shared links, identifies links shared with external users or marked public, and writes a security review report to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox vendor-invoice intake',
      prompt:
        'Build a scheduled workflow that lists a Dropbox vendor folder for invoice PDFs added since the last run, extracts vendor and amount with an agent, writes the row to a payables table, and pings finance on Slack.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox creative asset organizer',
      prompt:
        'Create a scheduled workflow that lists a Dropbox creative-assets folder, classifies files added since the last run by campaign and type, moves them into the right subfolder, and updates a tables-based asset index.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox retention sweeper',
      prompt:
        'Build a scheduled workflow that finds Dropbox files older than the retention policy, archives them to long-term storage, and writes the cleanup record to an audit table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox to Notion publisher',
      prompt:
        'Create a scheduled workflow that lists Dropbox markdown files added since the last run, converts each to a Notion page in the right database, and writes a link back to the source file metadata.',
      modules: ['scheduled', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['content', 'sync'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: DropboxIcon,
      title: 'Dropbox + DocuSign signed-doc archiver',
      prompt:
        'Build a scheduled workflow that polls DocuSign for completed envelopes, downloads each signed PDF, saves it to a Dropbox compliance folder, and writes the audit record to a contracts table.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'sync'],
      alsoIntegrations: ['docusign'],
    },
  ],
  skills: [
    {
      name: 'upload-file-to-dropbox',
      description:
        'Upload a file to a specific Dropbox path and optionally generate a shareable link.',
      content:
        '# Upload File to Dropbox\n\nSave a file into Dropbox at a chosen location and optionally share it.\n\n## Steps\n1. Determine the destination path, including the filename and extension (e.g., /reports/q3-summary.pdf).\n2. Call Upload File with the file and destination path. Use overwrite mode only if replacing an existing file; otherwise use add and enable auto-rename to avoid clobbering.\n3. If a shareable link is requested, call Create Shared Link on the uploaded path with the requested visibility (public, team-only, or password-protected).\n\n## Output\nReport the final stored path (after any auto-rename) and, if created, the shared link URL.',
    },
    {
      name: 'find-files-in-dropbox',
      description:
        'Search Dropbox for files by query, extension, or folder, and return matching paths.',
      content:
        '# Find Files in Dropbox\n\nLocate files in Dropbox matching a search term or filter.\n\n## Steps\n1. Use Search Files with the query term. Scope to a folder path when the location is known, and pass file extensions (e.g., pdf,xlsx) to narrow results.\n2. If browsing a known folder instead of searching, use List Folder with the folder path; enable recursive listing to include subfolders.\n3. For any candidate match, use Get Metadata to confirm size, type, and last-modified time before acting on it.\n\n## Output\nReturn the matching files as a list of path, name, size, and last-modified. If nothing matches, say so and suggest a broader query.',
    },
    {
      name: 'organize-dropbox-folder',
      description: 'List a folder and move, copy, or delete files to reorganize Dropbox contents.',
      content:
        '# Organize Dropbox Folder\n\nReorganize files in Dropbox by moving them into the right folders.\n\n## Steps\n1. Call List Folder on the source path to enumerate the files to process.\n2. Decide each file destination based on the requested rules (by type, date, campaign, or naming pattern). Create target folders with Create Folder if they do not exist.\n3. Use Move File/Folder to relocate each file, or Copy File/Folder when the original must stay in place. Enable auto-rename to avoid conflicts.\n\n## Output\nReturn a summary of every file moved or copied with its old and new path, and flag any operation that failed.',
    },
    {
      name: 'share-dropbox-link',
      description:
        'Create a shared link for a Dropbox file or folder with controlled visibility and expiration.',
      content:
        '# Share Dropbox Link\n\nGenerate a shareable link for an existing Dropbox item with the right access controls.\n\n## Steps\n1. Confirm the exact path of the file or folder. Use Get Metadata to verify it exists.\n2. Call Create Shared Link with the path and the requested visibility — public for anyone, team-only for internal sharing, or password-protected with a supplied password.\n3. Set an expiration date if the link should not be permanent.\n\n## Output\nReturn the shared link URL, its visibility setting, and the expiration date if one was applied.',
    },
  ],
} as const satisfies BlockMeta
