import { ConfluenceIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { ConfluenceResponse } from '@/tools/confluence/types'

export const ConfluenceBlock: BlockConfig<ConfluenceResponse> = {
  type: 'confluence',
  name: 'Confluence (Legacy)',
  description: 'Interact with Confluence',
  hideFromToolbar: true,
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Confluence into the workflow. Can read, create, update, delete pages, manage comments, attachments, labels, and search content.',
  docsLink: 'https://docs.sim.ai/tools/confluence',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: ConfluenceIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Page', id: 'read' },
        { label: 'Create Page', id: 'create' },
        { label: 'Update Page', id: 'update' },
        { label: 'Delete Page', id: 'delete' },
        { label: 'Search Content', id: 'search' },
        { label: 'Create Comment', id: 'create_comment' },
        { label: 'List Comments', id: 'list_comments' },
        { label: 'Update Comment', id: 'update_comment' },
        { label: 'Delete Comment', id: 'delete_comment' },
        { label: 'Upload Attachment', id: 'upload_attachment' },
        { label: 'List Attachments', id: 'list_attachments' },
        { label: 'Delete Attachment', id: 'delete_attachment' },
        { label: 'List Labels', id: 'list_labels' },
        { label: 'Get Space', id: 'get_space' },
        { label: 'List Spaces', id: 'list_spaces' },
      ],
      value: () => 'read',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Enter Confluence domain (e.g., simstudio.atlassian.net)',
      required: true,
    },
    {
      id: 'credential',
      title: 'Confluence Account',
      type: 'oauth-input',
      serviceId: 'confluence',
      requiredScopes: [
        'read:confluence-content.all',
        'read:confluence-space.summary',
        'read:space:confluence',
        'read:space-details:confluence',
        'write:confluence-content',
        'write:confluence-space',
        'write:confluence-file',
        'read:content:confluence',
        'read:page:confluence',
        'write:page:confluence',
        'read:comment:confluence',
        'write:comment:confluence',
        'delete:comment:confluence',
        'read:attachment:confluence',
        'write:attachment:confluence',
        'delete:attachment:confluence',
        'delete:page:confluence',
        'read:label:confluence',
        'write:label:confluence',
        'search:confluence',
        'read:me',
        'offline_access',
        'read:blogpost:confluence',
        'write:blogpost:confluence',
        'read:content.property:confluence',
        'write:content.property:confluence',
        'read:hierarchical-content:confluence',
        'read:content.metadata:confluence',
      ],
      placeholder: 'Select Confluence account',
      required: true,
    },
    {
      id: 'pageId',
      title: 'Select Page',
      type: 'file-selector',
      canonicalParamId: 'pageId',
      serviceId: 'confluence',
      placeholder: 'Select Confluence page',
      dependsOn: ['credential', 'domain'],
      mode: 'basic',
      required: {
        field: 'operation',
        value: [
          'read',
          'update',
          'delete',
          'create_comment',
          'list_comments',
          'list_attachments',
          'list_labels',
          'upload_attachment',
        ],
      },
    },
    {
      id: 'manualPageId',
      title: 'Page ID',
      type: 'short-input',
      canonicalParamId: 'pageId',
      placeholder: 'Enter Confluence page ID',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: [
          'read',
          'update',
          'delete',
          'create_comment',
          'list_comments',
          'list_attachments',
          'list_labels',
          'upload_attachment',
        ],
      },
    },
    {
      id: 'spaceId',
      title: 'Space ID',
      type: 'short-input',
      placeholder: 'Enter Confluence space ID',
      required: { field: 'operation', value: ['create', 'get_space'] },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter title for the page',
      condition: { field: 'operation', value: ['create', 'update'] },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter content for the page',
      condition: { field: 'operation', value: ['create', 'update'] },
    },
    {
      id: 'parentId',
      title: 'Parent Page ID',
      type: 'short-input',
      placeholder: 'Enter parent page ID (optional)',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search query',
      required: true,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'comment',
      title: 'Comment Text',
      type: 'long-input',
      placeholder: 'Enter comment text',
      required: true,
      condition: { field: 'operation', value: ['create_comment', 'update_comment'] },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Enter comment ID',
      required: true,
      condition: { field: 'operation', value: ['update_comment', 'delete_comment'] },
    },
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'Enter attachment ID',
      required: true,
      condition: { field: 'operation', value: 'delete_attachment' },
    },
    {
      id: 'attachmentFile',
      title: 'File',
      type: 'file-upload',
      placeholder: 'Select file to upload',
      required: true,
      condition: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'attachmentFileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional custom file name',
      condition: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'attachmentComment',
      title: 'Comment',
      type: 'short-input',
      placeholder: 'Optional comment for the attachment',
      condition: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'labelName',
      title: 'Label Name',
      type: 'short-input',
      placeholder: 'Enter label name',
      required: true,
      condition: { field: 'operation', value: ['add_label', 'remove_label'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Enter maximum number of results (default: 25)',
      condition: {
        field: 'operation',
        value: ['search', 'list_comments', 'list_attachments', 'list_spaces'],
      },
    },
  ],
  tools: {
    access: [
      'confluence_retrieve',
      'confluence_update',
      'confluence_create_page',
      'confluence_delete_page',
      'confluence_search',
      'confluence_create_comment',
      'confluence_list_comments',
      'confluence_update_comment',
      'confluence_delete_comment',
      'confluence_upload_attachment',
      'confluence_list_attachments',
      'confluence_delete_attachment',
      'confluence_list_labels',
      'confluence_get_space',
      'confluence_list_spaces',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'confluence_retrieve'
          case 'create':
            return 'confluence_create_page'
          case 'update':
            return 'confluence_update'
          case 'delete':
            return 'confluence_delete_page'
          case 'search':
            return 'confluence_search'
          case 'create_comment':
            return 'confluence_create_comment'
          case 'list_comments':
            return 'confluence_list_comments'
          case 'update_comment':
            return 'confluence_update_comment'
          case 'delete_comment':
            return 'confluence_delete_comment'
          case 'upload_attachment':
            return 'confluence_upload_attachment'
          case 'list_attachments':
            return 'confluence_list_attachments'
          case 'delete_attachment':
            return 'confluence_delete_attachment'
          case 'list_labels':
            return 'confluence_list_labels'
          case 'get_space':
            return 'confluence_get_space'
          case 'list_spaces':
            return 'confluence_list_spaces'
          default:
            return 'confluence_retrieve'
        }
      },
      params: (params) => {
        const {
          credential,
          pageId,
          operation,
          attachmentFile,
          attachmentFileName,
          attachmentComment,
          ...rest
        } = params

        const effectivePageId = pageId ? String(pageId).trim() : ''

        if (operation === 'upload_attachment') {
          return {
            credential,
            pageId: effectivePageId,
            operation,
            file: attachmentFile,
            fileName: attachmentFileName,
            comment: attachmentComment,
            ...rest,
          }
        }

        return {
          credential,
          pageId: effectivePageId || undefined,
          operation,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    domain: { type: 'string', description: 'Confluence domain' },
    credential: { type: 'string', description: 'Confluence access token' },
    pageId: { type: 'string', description: 'Page identifier (canonical param)' },
    spaceId: { type: 'string', description: 'Space identifier' },
    title: { type: 'string', description: 'Page title' },
    content: { type: 'string', description: 'Page content' },
    parentId: { type: 'string', description: 'Parent page identifier' },
    query: { type: 'string', description: 'Search query' },
    comment: { type: 'string', description: 'Comment text' },
    commentId: { type: 'string', description: 'Comment identifier' },
    attachmentId: { type: 'string', description: 'Attachment identifier' },
    attachmentFile: { type: 'json', description: 'File to upload as attachment (canonical param)' },
    attachmentFileName: { type: 'string', description: 'Custom file name for attachment' },
    attachmentComment: { type: 'string', description: 'Comment for the attachment' },
    labelName: { type: 'string', description: 'Label name' },
    limit: { type: 'number', description: 'Maximum number of results' },
  },
  outputs: {
    ts: { type: 'string', description: 'Timestamp' },
    pageId: { type: 'string', description: 'Page identifier' },
    content: { type: 'string', description: 'Page content' },
    body: { type: 'json', description: 'Page body with storage format' },
    title: { type: 'string', description: 'Page title' },
    url: { type: 'string', description: 'Page or resource URL' },
    success: { type: 'boolean', description: 'Operation success status' },
    deleted: { type: 'boolean', description: 'Deletion status' },
    added: { type: 'boolean', description: 'Addition status' },
    removed: { type: 'boolean', description: 'Removal status' },
    updated: { type: 'boolean', description: 'Update status' },
    results: { type: 'array', description: 'Search results' },
    comments: { type: 'array', description: 'List of comments' },
    attachments: { type: 'array', description: 'List of attachments' },
    labels: { type: 'array', description: 'List of labels' },
    spaces: { type: 'array', description: 'List of spaces' },
    commentId: { type: 'string', description: 'Comment identifier' },
    attachmentId: { type: 'string', description: 'Attachment identifier' },
    fileSize: { type: 'number', description: 'Attachment file size in bytes' },
    mediaType: { type: 'string', description: 'Attachment MIME type' },
    downloadUrl: { type: 'string', description: 'Attachment download URL' },
    labelName: { type: 'string', description: 'Label name' },
    spaceId: { type: 'string', description: 'Space identifier' },
    name: { type: 'string', description: 'Space name' },
    key: { type: 'string', description: 'Space key' },
    type: { type: 'string', description: 'Space or content type' },
    status: { type: 'string', description: 'Space status' },
  },
}

export const ConfluenceV2Block: BlockConfig<ConfluenceResponse> = {
  ...ConfluenceBlock,
  type: 'confluence_v2',
  name: 'Confluence',
  hideFromToolbar: false,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Page Operations
        { label: 'Read Page', id: 'read' },
        { label: 'Create Page', id: 'create' },
        { label: 'Update Page', id: 'update' },
        { label: 'Delete Page', id: 'delete' },
        { label: 'List Pages in Space', id: 'list_pages_in_space' },
        { label: 'Get Page Children', id: 'get_page_children' },
        { label: 'Get Page Ancestors', id: 'get_page_ancestors' },
        // Version Operations
        { label: 'List Page Versions', id: 'list_page_versions' },
        { label: 'Get Page Version', id: 'get_page_version' },
        // Page Property Operations
        { label: 'List Page Properties', id: 'list_page_properties' },
        { label: 'Create Page Property', id: 'create_page_property' },
        // Search Operations
        { label: 'Search Content', id: 'search' },
        { label: 'Search in Space', id: 'search_in_space' },
        // Blog Post Operations
        { label: 'List Blog Posts', id: 'list_blogposts' },
        { label: 'Get Blog Post', id: 'get_blogpost' },
        { label: 'Create Blog Post', id: 'create_blogpost' },
        { label: 'List Blog Posts in Space', id: 'list_blogposts_in_space' },
        // Comment Operations
        { label: 'Create Comment', id: 'create_comment' },
        { label: 'List Comments', id: 'list_comments' },
        { label: 'Update Comment', id: 'update_comment' },
        { label: 'Delete Comment', id: 'delete_comment' },
        // Attachment Operations
        { label: 'Upload Attachment', id: 'upload_attachment' },
        { label: 'List Attachments', id: 'list_attachments' },
        { label: 'Delete Attachment', id: 'delete_attachment' },
        // Label Operations
        { label: 'List Labels', id: 'list_labels' },
        { label: 'Add Label', id: 'add_label' },
        // Space Operations
        { label: 'Get Space', id: 'get_space' },
        { label: 'List Spaces', id: 'list_spaces' },
      ],
      value: () => 'read',
    },
    {
      id: 'credential',
      title: 'Confluence Account',
      type: 'oauth-input',
      serviceId: 'confluence',
      requiredScopes: [
        'read:confluence-content.all',
        'read:confluence-space.summary',
        'read:space:confluence',
        'read:space-details:confluence',
        'write:confluence-content',
        'write:confluence-space',
        'write:confluence-file',
        'read:content:confluence',
        'read:page:confluence',
        'write:page:confluence',
        'read:comment:confluence',
        'write:comment:confluence',
        'delete:comment:confluence',
        'read:attachment:confluence',
        'write:attachment:confluence',
        'delete:attachment:confluence',
        'delete:page:confluence',
        'read:label:confluence',
        'write:label:confluence',
        'search:confluence',
        'read:me',
        'offline_access',
        'read:blogpost:confluence',
        'write:blogpost:confluence',
        'read:content.property:confluence',
        'write:content.property:confluence',
        'read:hierarchical-content:confluence',
        'read:content.metadata:confluence',
      ],
      placeholder: 'Select Confluence account',
      required: true,
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Enter Confluence domain (e.g., simstudio.atlassian.net)',
      required: true,
    },
    {
      id: 'pageId',
      title: 'Select Page',
      type: 'file-selector',
      canonicalParamId: 'pageId',
      serviceId: 'confluence',
      placeholder: 'Select Confluence page',
      dependsOn: ['credential', 'domain'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'list_pages_in_space',
          'list_blogposts',
          'get_blogpost',
          'list_blogposts_in_space',
          'search',
          'search_in_space',
          'get_space',
          'list_spaces',
        ],
        not: true,
      },
      required: {
        field: 'operation',
        value: [
          'read',
          'update',
          'delete',
          'create_comment',
          'list_comments',
          'list_attachments',
          'list_labels',
          'upload_attachment',
          'add_label',
          'get_page_children',
          'get_page_ancestors',
          'list_page_versions',
          'get_page_version',
          'list_page_properties',
          'create_page_property',
        ],
      },
    },
    {
      id: 'manualPageId',
      title: 'Page ID',
      type: 'short-input',
      canonicalParamId: 'pageId',
      placeholder: 'Enter Confluence page ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_pages_in_space',
          'list_blogposts',
          'get_blogpost',
          'list_blogposts_in_space',
          'search',
          'search_in_space',
          'get_space',
          'list_spaces',
        ],
        not: true,
      },
      required: {
        field: 'operation',
        value: [
          'read',
          'update',
          'delete',
          'create_comment',
          'list_comments',
          'list_attachments',
          'list_labels',
          'upload_attachment',
          'add_label',
          'get_page_children',
          'get_page_ancestors',
          'list_page_versions',
          'get_page_version',
          'list_page_properties',
          'create_page_property',
        ],
      },
    },
    {
      id: 'spaceId',
      title: 'Space ID',
      type: 'short-input',
      placeholder: 'Enter Confluence space ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'create',
          'get_space',
          'list_pages_in_space',
          'search_in_space',
          'create_blogpost',
          'list_blogposts_in_space',
        ],
      },
    },
    {
      id: 'blogPostId',
      title: 'Blog Post ID',
      type: 'short-input',
      placeholder: 'Enter blog post ID',
      required: true,
      condition: { field: 'operation', value: 'get_blogpost' },
    },
    {
      id: 'versionNumber',
      title: 'Version Number',
      type: 'short-input',
      placeholder: 'Enter version number',
      required: true,
      condition: { field: 'operation', value: 'get_page_version' },
    },
    {
      id: 'propertyKey',
      title: 'Property Key',
      type: 'short-input',
      placeholder: 'Enter property key/name',
      required: true,
      condition: { field: 'operation', value: 'create_page_property' },
    },
    {
      id: 'propertyValue',
      title: 'Property Value',
      type: 'long-input',
      placeholder: 'Enter property value (JSON supported)',
      required: true,
      condition: { field: 'operation', value: 'create_page_property' },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter title',
      condition: { field: 'operation', value: ['create', 'update', 'create_blogpost'] },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter content',
      condition: { field: 'operation', value: ['create', 'update', 'create_blogpost'] },
    },
    {
      id: 'parentId',
      title: 'Parent Page ID',
      type: 'short-input',
      placeholder: 'Enter parent page ID (optional)',
      condition: { field: 'operation', value: 'create' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search query',
      required: true,
      condition: { field: 'operation', value: ['search', 'search_in_space'] },
    },
    {
      id: 'comment',
      title: 'Comment Text',
      type: 'long-input',
      placeholder: 'Enter comment text',
      required: true,
      condition: { field: 'operation', value: ['create_comment', 'update_comment'] },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Enter comment ID',
      required: true,
      condition: { field: 'operation', value: ['update_comment', 'delete_comment'] },
    },
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'Enter attachment ID',
      required: true,
      condition: { field: 'operation', value: 'delete_attachment' },
    },
    {
      id: 'attachmentFileUpload',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'attachmentFile',
      placeholder: 'Select file to upload',
      condition: { field: 'operation', value: 'upload_attachment' },
      mode: 'basic',
      required: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'attachmentFileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'attachmentFile',
      placeholder: 'Reference file from previous blocks',
      condition: { field: 'operation', value: 'upload_attachment' },
      mode: 'advanced',
      required: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'attachmentFileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional custom file name',
      condition: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'attachmentComment',
      title: 'Comment',
      type: 'short-input',
      placeholder: 'Optional comment for the attachment',
      condition: { field: 'operation', value: 'upload_attachment' },
    },
    {
      id: 'labelName',
      title: 'Label Name',
      type: 'short-input',
      placeholder: 'Enter label name',
      required: true,
      condition: { field: 'operation', value: 'add_label' },
    },
    {
      id: 'labelPrefix',
      title: 'Label Prefix',
      type: 'dropdown',
      options: [
        { label: 'Global (default)', id: 'global' },
        { label: 'My', id: 'my' },
        { label: 'Team', id: 'team' },
        { label: 'System', id: 'system' },
      ],
      value: () => 'global',
      condition: { field: 'operation', value: 'add_label' },
    },
    {
      id: 'blogPostStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Published (current)', id: 'current' },
        { label: 'Draft', id: 'draft' },
      ],
      value: () => 'current',
      condition: { field: 'operation', value: 'create_blogpost' },
    },
    {
      id: 'purge',
      title: 'Permanently Delete',
      type: 'switch',
      condition: { field: 'operation', value: 'delete' },
    },
    {
      id: 'bodyFormat',
      title: 'Body Format',
      type: 'dropdown',
      options: [
        { label: 'Storage (default)', id: 'storage' },
        { label: 'Atlas Doc Format', id: 'atlas_doc_format' },
        { label: 'View', id: 'view' },
        { label: 'Export View', id: 'export_view' },
      ],
      value: () => 'storage',
      condition: { field: 'operation', value: 'list_comments' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Enter maximum number of results (default: 50, max: 250)',
      condition: {
        field: 'operation',
        value: [
          'search',
          'search_in_space',
          'list_comments',
          'list_attachments',
          'list_spaces',
          'list_pages_in_space',
          'list_blogposts',
          'list_blogposts_in_space',
          'get_page_children',
          'list_page_versions',
          'list_page_properties',
          'list_labels',
        ],
      },
    },
    {
      id: 'cursor',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'Enter cursor from previous response (optional)',
      condition: {
        field: 'operation',
        value: [
          'list_comments',
          'list_attachments',
          'list_spaces',
          'list_pages_in_space',
          'list_blogposts',
          'list_blogposts_in_space',
          'get_page_children',
          'list_page_versions',
          'list_page_properties',
          'list_labels',
        ],
      },
    },
  ],
  tools: {
    access: [
      // Page Tools
      'confluence_retrieve',
      'confluence_update',
      'confluence_create_page',
      'confluence_delete_page',
      'confluence_list_pages_in_space',
      'confluence_get_page_children',
      'confluence_get_page_ancestors',
      // Version Tools
      'confluence_list_page_versions',
      'confluence_get_page_version',
      // Property Tools
      'confluence_list_page_properties',
      'confluence_create_page_property',
      // Search Tools
      'confluence_search',
      'confluence_search_in_space',
      // Blog Post Tools
      'confluence_list_blogposts',
      'confluence_get_blogpost',
      'confluence_create_blogpost',
      'confluence_list_blogposts_in_space',
      // Comment Tools
      'confluence_create_comment',
      'confluence_list_comments',
      'confluence_update_comment',
      'confluence_delete_comment',
      // Attachment Tools
      'confluence_upload_attachment',
      'confluence_list_attachments',
      'confluence_delete_attachment',
      // Label Tools
      'confluence_list_labels',
      'confluence_add_label',
      // Space Tools
      'confluence_get_space',
      'confluence_list_spaces',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          // Page Operations
          case 'read':
            return 'confluence_retrieve'
          case 'create':
            return 'confluence_create_page'
          case 'update':
            return 'confluence_update'
          case 'delete':
            return 'confluence_delete_page'
          case 'list_pages_in_space':
            return 'confluence_list_pages_in_space'
          case 'get_page_children':
            return 'confluence_get_page_children'
          case 'get_page_ancestors':
            return 'confluence_get_page_ancestors'
          // Version Operations
          case 'list_page_versions':
            return 'confluence_list_page_versions'
          case 'get_page_version':
            return 'confluence_get_page_version'
          // Property Operations
          case 'list_page_properties':
            return 'confluence_list_page_properties'
          case 'create_page_property':
            return 'confluence_create_page_property'
          // Search Operations
          case 'search':
            return 'confluence_search'
          case 'search_in_space':
            return 'confluence_search_in_space'
          // Blog Post Operations
          case 'list_blogposts':
            return 'confluence_list_blogposts'
          case 'get_blogpost':
            return 'confluence_get_blogpost'
          case 'create_blogpost':
            return 'confluence_create_blogpost'
          case 'list_blogposts_in_space':
            return 'confluence_list_blogposts_in_space'
          // Comment Operations
          case 'create_comment':
            return 'confluence_create_comment'
          case 'list_comments':
            return 'confluence_list_comments'
          case 'update_comment':
            return 'confluence_update_comment'
          case 'delete_comment':
            return 'confluence_delete_comment'
          // Attachment Operations
          case 'upload_attachment':
            return 'confluence_upload_attachment'
          case 'list_attachments':
            return 'confluence_list_attachments'
          case 'delete_attachment':
            return 'confluence_delete_attachment'
          // Label Operations
          case 'list_labels':
            return 'confluence_list_labels'
          case 'add_label':
            return 'confluence_add_label'
          // Space Operations
          case 'get_space':
            return 'confluence_get_space'
          case 'list_spaces':
            return 'confluence_list_spaces'
          default:
            return 'confluence_retrieve'
        }
      },
      params: (params) => {
        const {
          credential,
          pageId,
          operation,
          attachmentFile,
          attachmentFileName,
          attachmentComment,
          blogPostId,
          versionNumber,
          propertyKey,
          propertyValue,
          labelPrefix,
          blogPostStatus,
          purge,
          bodyFormat,
          cursor,
          ...rest
        } = params

        // Use canonical param (serializer already handles basic/advanced mode)
        const effectivePageId = pageId ? String(pageId).trim() : ''

        if (operation === 'add_label') {
          return {
            credential,
            pageId: effectivePageId,
            operation,
            prefix: labelPrefix || 'global',
            ...rest,
          }
        }

        if (operation === 'create_blogpost') {
          return {
            credential,
            operation,
            status: blogPostStatus || 'current',
            ...rest,
          }
        }

        if (operation === 'delete') {
          return {
            credential,
            pageId: effectivePageId,
            operation,
            purge: purge || false,
            ...rest,
          }
        }

        if (operation === 'list_comments') {
          return {
            credential,
            pageId: effectivePageId,
            operation,
            bodyFormat: bodyFormat || 'storage',
            cursor: cursor || undefined,
            ...rest,
          }
        }

        // Operations that support cursor pagination
        const supportsCursor = [
          'list_attachments',
          'list_spaces',
          'list_pages_in_space',
          'list_blogposts',
          'list_blogposts_in_space',
          'get_page_children',
          'list_page_versions',
          'list_page_properties',
          'list_labels',
        ]

        if (supportsCursor.includes(operation) && cursor) {
          return {
            credential,
            pageId: effectivePageId || undefined,
            operation,
            cursor,
            ...rest,
          }
        }

        if (operation === 'create_page_property') {
          if (!propertyKey) {
            throw new Error('Property key is required for this operation.')
          }
          return {
            credential,
            pageId: effectivePageId,
            operation,
            key: propertyKey,
            value: propertyValue,
            ...rest,
          }
        }

        if (operation === 'upload_attachment') {
          const normalizedFile = normalizeFileInput(attachmentFile, { single: true })
          if (!normalizedFile) {
            throw new Error('File is required for upload attachment operation.')
          }
          return {
            credential,
            pageId: effectivePageId,
            operation,
            file: normalizedFile,
            fileName: attachmentFileName,
            comment: attachmentComment,
            ...rest,
          }
        }

        return {
          credential,
          pageId: effectivePageId || undefined,
          blogPostId: blogPostId || undefined,
          versionNumber: versionNumber ? Number.parseInt(String(versionNumber), 10) : undefined,
          operation,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    domain: { type: 'string', description: 'Confluence domain' },
    credential: { type: 'string', description: 'Confluence access token' },
    pageId: { type: 'string', description: 'Page identifier (canonical param)' },
    spaceId: { type: 'string', description: 'Space identifier' },
    blogPostId: { type: 'string', description: 'Blog post identifier' },
    versionNumber: { type: 'number', description: 'Page version number' },
    propertyKey: { type: 'string', description: 'Property key/name' },
    propertyValue: { type: 'json', description: 'Property value (JSON)' },
    title: { type: 'string', description: 'Page or blog post title' },
    content: { type: 'string', description: 'Page or blog post content' },
    parentId: { type: 'string', description: 'Parent page identifier' },
    query: { type: 'string', description: 'Search query' },
    comment: { type: 'string', description: 'Comment text' },
    commentId: { type: 'string', description: 'Comment identifier' },
    attachmentId: { type: 'string', description: 'Attachment identifier' },
    attachmentFile: { type: 'json', description: 'File to upload as attachment (canonical param)' },
    attachmentFileName: { type: 'string', description: 'Custom file name for attachment' },
    attachmentComment: { type: 'string', description: 'Comment for the attachment' },
    labelName: { type: 'string', description: 'Label name' },
    labelPrefix: { type: 'string', description: 'Label prefix (global, my, team, system)' },
    blogPostStatus: { type: 'string', description: 'Blog post status (current or draft)' },
    purge: { type: 'boolean', description: 'Permanently delete instead of moving to trash' },
    bodyFormat: { type: 'string', description: 'Body format for comments' },
    limit: { type: 'number', description: 'Maximum number of results' },
    cursor: { type: 'string', description: 'Pagination cursor from previous response' },
  },
  outputs: {
    ts: { type: 'string', description: 'Timestamp' },
    pageId: { type: 'string', description: 'Page identifier' },
    content: { type: 'string', description: 'Page content' },
    body: { type: 'json', description: 'Page body with storage format' },
    title: { type: 'string', description: 'Page title' },
    url: { type: 'string', description: 'Page or resource URL' },
    success: { type: 'boolean', description: 'Operation success status' },
    deleted: { type: 'boolean', description: 'Deletion status' },
    added: { type: 'boolean', description: 'Addition status' },
    removed: { type: 'boolean', description: 'Removal status' },
    updated: { type: 'boolean', description: 'Update status' },
    // Search & List Results
    results: { type: 'array', description: 'Search results' },
    pages: { type: 'array', description: 'List of pages' },
    children: { type: 'array', description: 'List of child pages' },
    ancestors: { type: 'array', description: 'List of ancestor pages' },
    // Comment Results
    comments: { type: 'array', description: 'List of comments' },
    commentId: { type: 'string', description: 'Comment identifier' },
    // Attachment Results
    attachments: { type: 'array', description: 'List of attachments' },
    attachmentId: { type: 'string', description: 'Attachment identifier' },
    fileSize: { type: 'number', description: 'Attachment file size in bytes' },
    mediaType: { type: 'string', description: 'Attachment MIME type' },
    downloadUrl: { type: 'string', description: 'Attachment download URL' },
    // Label Results
    labels: { type: 'array', description: 'List of labels' },
    labelName: { type: 'string', description: 'Label name' },
    // Space Results
    spaces: { type: 'array', description: 'List of spaces' },
    spaceId: { type: 'string', description: 'Space identifier' },
    name: { type: 'string', description: 'Space name' },
    key: { type: 'string', description: 'Space key' },
    type: { type: 'string', description: 'Space or content type' },
    status: { type: 'string', description: 'Space status' },
    // Blog Post Results
    blogPosts: { type: 'array', description: 'List of blog posts' },
    blogPostId: { type: 'string', description: 'Blog post identifier' },
    // Version Results
    versions: { type: 'array', description: 'List of page versions' },
    version: { type: 'json', description: 'Version information' },
    versionNumber: { type: 'number', description: 'Version number' },
    // Property Results
    properties: { type: 'array', description: 'List of page properties' },
    propertyId: { type: 'string', description: 'Property identifier' },
    propertyKey: { type: 'string', description: 'Property key' },
    propertyValue: { type: 'json', description: 'Property value' },
    // Pagination
    nextCursor: { type: 'string', description: 'Cursor for fetching next page of results' },
  },
}
