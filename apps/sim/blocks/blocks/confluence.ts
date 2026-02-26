import { ConfluenceIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { ConfluenceResponse } from '@/tools/confluence/types'
import { getTrigger } from '@/triggers'

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
      placeholder: 'Enter Confluence domain (e.g., company.atlassian.net)',
      required: true,
    },
    {
      id: 'credential',
      title: 'Confluence Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
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
        'read:user:confluence',
      ],
      placeholder: 'Select Confluence account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Confluence Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
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
          oauthCredential,
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
            credential: oauthCredential,
            pageId: effectivePageId,
            operation,
            file: attachmentFile,
            fileName: attachmentFileName,
            comment: attachmentComment,
            ...rest,
          }
        }

        return {
          credential: oauthCredential,
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
    oauthCredential: { type: 'string', description: 'Confluence access token' },
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
        { label: 'Delete Page Property', id: 'delete_page_property' },
        // Search Operations
        { label: 'Search Content', id: 'search' },
        { label: 'Search in Space', id: 'search_in_space' },
        // Blog Post Operations
        { label: 'List Blog Posts', id: 'list_blogposts' },
        { label: 'Get Blog Post', id: 'get_blogpost' },
        { label: 'Create Blog Post', id: 'create_blogpost' },
        { label: 'Update Blog Post', id: 'update_blogpost' },
        { label: 'Delete Blog Post', id: 'delete_blogpost' },
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
        { label: 'Delete Label', id: 'delete_label' },
        { label: 'Get Pages by Label', id: 'get_pages_by_label' },
        { label: 'List Space Labels', id: 'list_space_labels' },
        // Space Operations
        { label: 'Get Space', id: 'get_space' },
        { label: 'Create Space', id: 'create_space' },
        { label: 'Update Space', id: 'update_space' },
        { label: 'Delete Space', id: 'delete_space' },
        { label: 'List Spaces', id: 'list_spaces' },
        // Space Property Operations
        { label: 'List Space Properties', id: 'list_space_properties' },
        { label: 'Create Space Property', id: 'create_space_property' },
        { label: 'Delete Space Property', id: 'delete_space_property' },
        // Space Permission Operations
        { label: 'List Space Permissions', id: 'list_space_permissions' },
        // Page Descendant Operations
        { label: 'Get Page Descendants', id: 'get_page_descendants' },
        // Task Operations
        { label: 'List Tasks', id: 'list_tasks' },
        { label: 'Get Task', id: 'get_task' },
        { label: 'Update Task', id: 'update_task' },
        // User Operations
        { label: 'Get User', id: 'get_user' },
      ],
      value: () => 'read',
    },
    {
      id: 'credential',
      title: 'Confluence Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
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
        'read:user:confluence',
        'read:task:confluence',
        'write:task:confluence',
        'delete:blogpost:confluence',
        'write:space:confluence',
        'delete:space:confluence',
        'read:space.property:confluence',
        'write:space.property:confluence',
        'read:space.permission:confluence',
      ],
      placeholder: 'Select Confluence account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Confluence Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Enter Confluence domain (e.g., company.atlassian.net)',
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
          'update_blogpost',
          'delete_blogpost',
          'list_blogposts_in_space',
          'search',
          'search_in_space',
          'get_space',
          'create_space',
          'update_space',
          'delete_space',
          'list_spaces',
          'get_pages_by_label',
          'list_space_labels',
          'list_space_permissions',
          'list_space_properties',
          'create_space_property',
          'delete_space_property',
          'list_tasks',
          'get_task',
          'update_task',
          'get_user',
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
          'delete_label',
          'delete_page_property',
          'get_page_children',
          'get_page_ancestors',
          'list_page_versions',
          'get_page_version',
          'list_page_properties',
          'create_page_property',
          'get_page_descendants',
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
          'update_blogpost',
          'delete_blogpost',
          'list_blogposts_in_space',
          'search',
          'search_in_space',
          'get_space',
          'create_space',
          'update_space',
          'delete_space',
          'list_spaces',
          'get_pages_by_label',
          'list_space_labels',
          'list_space_permissions',
          'list_space_properties',
          'create_space_property',
          'delete_space_property',
          'list_tasks',
          'get_task',
          'update_task',
          'get_user',
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
          'delete_label',
          'delete_page_property',
          'get_page_children',
          'get_page_ancestors',
          'list_page_versions',
          'get_page_version',
          'list_page_properties',
          'create_page_property',
          'get_page_descendants',
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
          'update_space',
          'delete_space',
          'list_pages_in_space',
          'search_in_space',
          'create_blogpost',
          'list_blogposts_in_space',
          'list_space_labels',
          'list_space_permissions',
          'list_space_properties',
          'create_space_property',
          'delete_space_property',
        ],
      },
    },
    {
      id: 'blogPostId',
      title: 'Blog Post ID',
      type: 'short-input',
      placeholder: 'Enter blog post ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_blogpost', 'update_blogpost', 'delete_blogpost'],
      },
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
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Enter Atlassian account ID',
      required: true,
      condition: { field: 'operation', value: 'get_user' },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Enter task ID',
      required: true,
      condition: { field: 'operation', value: ['get_task', 'update_task'] },
    },
    {
      id: 'taskStatus',
      title: 'Task Status',
      type: 'dropdown',
      options: [
        { label: 'Complete', id: 'complete' },
        { label: 'Incomplete', id: 'incomplete' },
      ],
      value: () => 'complete',
      condition: { field: 'operation', value: 'update_task' },
    },
    {
      id: 'taskAssignedTo',
      title: 'Assigned To',
      type: 'short-input',
      placeholder: 'Filter by assignee account ID (optional)',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'spaceName',
      title: 'Space Name',
      type: 'short-input',
      placeholder: 'Enter space name',
      required: true,
      condition: { field: 'operation', value: 'create_space' },
    },
    {
      id: 'spaceKey',
      title: 'Space Key',
      type: 'short-input',
      placeholder: 'Enter space key (e.g., MYSPACE)',
      required: true,
      condition: { field: 'operation', value: 'create_space' },
    },
    {
      id: 'spaceDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter space description (optional)',
      condition: { field: 'operation', value: ['create_space', 'update_space'] },
    },
    {
      id: 'spacePropertyKey',
      title: 'Property Key',
      type: 'short-input',
      placeholder: 'Enter property key/name',
      required: true,
      condition: { field: 'operation', value: 'create_space_property' },
    },
    {
      id: 'spacePropertyValue',
      title: 'Property Value',
      type: 'long-input',
      placeholder: 'Enter property value (JSON supported)',
      condition: { field: 'operation', value: 'create_space_property' },
    },
    {
      id: 'spacePropertyId',
      title: 'Property ID',
      type: 'short-input',
      placeholder: 'Enter property ID to delete',
      required: true,
      condition: { field: 'operation', value: 'delete_space_property' },
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
      id: 'propertyId',
      title: 'Property ID',
      type: 'short-input',
      placeholder: 'Enter property ID to delete',
      required: true,
      condition: { field: 'operation', value: 'delete_page_property' },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter title',
      condition: {
        field: 'operation',
        value: ['create', 'update', 'create_blogpost', 'update_blogpost', 'update_space'],
      },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Enter content',
      condition: {
        field: 'operation',
        value: ['create', 'update', 'create_blogpost', 'update_blogpost'],
      },
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
      condition: { field: 'operation', value: ['add_label', 'delete_label'] },
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
      id: 'labelId',
      title: 'Label ID',
      type: 'short-input',
      placeholder: 'Enter label ID',
      required: true,
      condition: { field: 'operation', value: 'get_pages_by_label' },
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
          'get_pages_by_label',
          'list_space_labels',
          'get_page_descendants',
          'list_space_permissions',
          'list_space_properties',
          'list_tasks',
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
          'get_pages_by_label',
          'list_space_labels',
          'get_page_descendants',
          'list_space_permissions',
          'list_space_properties',
          'list_tasks',
        ],
      },
    },

    // Trigger subBlocks
    ...getTrigger('confluence_page_created').subBlocks,
    ...getTrigger('confluence_page_updated').subBlocks,
    ...getTrigger('confluence_page_removed').subBlocks,
    ...getTrigger('confluence_page_moved').subBlocks,
    ...getTrigger('confluence_comment_created').subBlocks,
    ...getTrigger('confluence_comment_removed').subBlocks,
    ...getTrigger('confluence_blog_created').subBlocks,
    ...getTrigger('confluence_blog_updated').subBlocks,
    ...getTrigger('confluence_blog_removed').subBlocks,
    ...getTrigger('confluence_attachment_created').subBlocks,
    ...getTrigger('confluence_attachment_removed').subBlocks,
    ...getTrigger('confluence_space_created').subBlocks,
    ...getTrigger('confluence_space_updated').subBlocks,
    ...getTrigger('confluence_label_added').subBlocks,
    ...getTrigger('confluence_label_removed').subBlocks,
    ...getTrigger('confluence_webhook').subBlocks,
  ],
  triggers: {
    enabled: true,
    available: [
      'confluence_page_created',
      'confluence_page_updated',
      'confluence_page_removed',
      'confluence_page_moved',
      'confluence_comment_created',
      'confluence_comment_removed',
      'confluence_blog_created',
      'confluence_blog_updated',
      'confluence_blog_removed',
      'confluence_attachment_created',
      'confluence_attachment_removed',
      'confluence_space_created',
      'confluence_space_updated',
      'confluence_label_added',
      'confluence_label_removed',
      'confluence_webhook',
    ],
  },
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
      'confluence_delete_page_property',
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
      'confluence_delete_label',
      'confluence_get_pages_by_label',
      'confluence_list_space_labels',
      // Space Tools
      'confluence_get_space',
      'confluence_create_space',
      'confluence_update_space',
      'confluence_delete_space',
      'confluence_list_spaces',
      // Space Property Tools
      'confluence_list_space_properties',
      'confluence_create_space_property',
      'confluence_delete_space_property',
      // Space Permission Tools
      'confluence_list_space_permissions',
      // Page Descendant Tools
      'confluence_get_page_descendants',
      // Task Tools
      'confluence_list_tasks',
      'confluence_get_task',
      'confluence_update_task',
      // Blog Post Update/Delete
      'confluence_update_blogpost',
      'confluence_delete_blogpost',
      // User Tools
      'confluence_get_user',
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
          case 'delete_page_property':
            return 'confluence_delete_page_property'
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
          case 'update_blogpost':
            return 'confluence_update_blogpost'
          case 'delete_blogpost':
            return 'confluence_delete_blogpost'
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
          case 'delete_label':
            return 'confluence_delete_label'
          case 'get_pages_by_label':
            return 'confluence_get_pages_by_label'
          case 'list_space_labels':
            return 'confluence_list_space_labels'
          // Space Operations
          case 'get_space':
            return 'confluence_get_space'
          case 'create_space':
            return 'confluence_create_space'
          case 'update_space':
            return 'confluence_update_space'
          case 'delete_space':
            return 'confluence_delete_space'
          case 'list_spaces':
            return 'confluence_list_spaces'
          // Space Property Operations
          case 'list_space_properties':
            return 'confluence_list_space_properties'
          case 'create_space_property':
            return 'confluence_create_space_property'
          case 'delete_space_property':
            return 'confluence_delete_space_property'
          // Space Permission Operations
          case 'list_space_permissions':
            return 'confluence_list_space_permissions'
          // Page Descendant Operations
          case 'get_page_descendants':
            return 'confluence_get_page_descendants'
          // Task Operations
          case 'list_tasks':
            return 'confluence_list_tasks'
          case 'get_task':
            return 'confluence_get_task'
          case 'update_task':
            return 'confluence_update_task'
          // User Operations
          case 'get_user':
            return 'confluence_get_user'
          default:
            return 'confluence_retrieve'
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          pageId,
          operation,
          attachmentFile,
          attachmentFileName,
          attachmentComment,
          blogPostId,
          versionNumber,
          accountId,
          propertyKey,
          propertyValue,
          propertyId,
          labelPrefix,
          labelId,
          blogPostStatus,
          purge,
          bodyFormat,
          cursor,
          taskId,
          taskStatus,
          taskAssignedTo,
          spaceName,
          spaceKey,
          spaceDescription,
          spacePropertyKey,
          spacePropertyValue,
          spacePropertyId,
          ...rest
        } = params

        // Use canonical param (serializer already handles basic/advanced mode)
        const effectivePageId = pageId ? String(pageId).trim() : ''

        if (operation === 'add_label') {
          return {
            credential: oauthCredential,
            pageId: effectivePageId,
            operation,
            prefix: labelPrefix || 'global',
            ...rest,
          }
        }

        if (operation === 'create_blogpost') {
          return {
            credential: oauthCredential,
            operation,
            status: blogPostStatus || 'current',
            ...rest,
          }
        }

        if (operation === 'delete') {
          return {
            credential: oauthCredential,
            pageId: effectivePageId,
            operation,
            purge: purge || false,
            ...rest,
          }
        }

        if (operation === 'list_comments') {
          return {
            credential: oauthCredential,
            pageId: effectivePageId,
            operation,
            bodyFormat: bodyFormat || 'storage',
            cursor: cursor || undefined,
            ...rest,
          }
        }

        // Operations that support generic cursor pagination.
        // get_pages_by_label, list_space_labels, and list_tasks have dedicated handlers
        // below that pass cursor along with their required params.
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
          'get_page_descendants',
          'list_space_permissions',
          'list_space_properties',
        ]

        if (supportsCursor.includes(operation) && cursor) {
          return {
            credential: oauthCredential,
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
            credential: oauthCredential,
            pageId: effectivePageId,
            operation,
            key: propertyKey,
            value: propertyValue,
            ...rest,
          }
        }

        if (operation === 'delete_page_property') {
          return {
            credential: oauthCredential,
            pageId: effectivePageId,
            operation,
            propertyId,
            ...rest,
          }
        }

        if (operation === 'get_pages_by_label') {
          return {
            credential: oauthCredential,
            operation,
            labelId,
            cursor: cursor || undefined,
            ...rest,
          }
        }

        if (operation === 'list_space_labels') {
          return {
            credential: oauthCredential,
            operation,
            cursor: cursor || undefined,
            ...rest,
          }
        }

        if (operation === 'upload_attachment') {
          const normalizedFile = normalizeFileInput(attachmentFile, { single: true })
          if (!normalizedFile) {
            throw new Error('File is required for upload attachment operation.')
          }
          return {
            credential: oauthCredential,
            pageId: effectivePageId,
            operation,
            file: normalizedFile,
            fileName: attachmentFileName,
            comment: attachmentComment,
            ...rest,
          }
        }

        if (operation === 'get_user') {
          return {
            credential: oauthCredential,
            operation,
            accountId: accountId ? String(accountId).trim() : undefined,
            ...rest,
          }
        }

        if (operation === 'update_blogpost' || operation === 'delete_blogpost') {
          return {
            credential: oauthCredential,
            operation,
            blogPostId: blogPostId || undefined,
            ...rest,
          }
        }

        if (operation === 'create_space') {
          return {
            credential: oauthCredential,
            operation,
            name: spaceName,
            key: spaceKey,
            description: spaceDescription,
            ...rest,
          }
        }

        if (operation === 'update_space') {
          return {
            credential: oauthCredential,
            operation,
            name: spaceName || rest.title,
            description: spaceDescription,
            ...rest,
          }
        }

        if (operation === 'delete_space') {
          return {
            credential: oauthCredential,
            operation,
            ...rest,
          }
        }

        if (operation === 'create_space_property') {
          return {
            credential: oauthCredential,
            operation,
            key: spacePropertyKey,
            value: spacePropertyValue,
            ...rest,
          }
        }

        if (operation === 'delete_space_property') {
          return {
            credential: oauthCredential,
            operation,
            propertyId: spacePropertyId,
            ...rest,
          }
        }

        if (operation === 'list_space_permissions' || operation === 'list_space_properties') {
          return {
            credential: oauthCredential,
            operation,
            cursor: cursor || undefined,
            ...rest,
          }
        }

        if (operation === 'get_page_descendants') {
          return {
            credential: oauthCredential,
            pageId: effectivePageId,
            operation,
            cursor: cursor || undefined,
            ...rest,
          }
        }

        if (operation === 'get_task') {
          return {
            credential: oauthCredential,
            operation,
            taskId,
            ...rest,
          }
        }

        if (operation === 'update_task') {
          return {
            credential: oauthCredential,
            operation,
            taskId,
            status: taskStatus,
            ...rest,
          }
        }

        if (operation === 'list_tasks') {
          return {
            credential: oauthCredential,
            operation,
            pageId: effectivePageId || undefined,
            assignedTo: taskAssignedTo || undefined,
            status: taskStatus || undefined,
            cursor: cursor || undefined,
            ...rest,
          }
        }

        return {
          credential: oauthCredential,
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
    oauthCredential: { type: 'string', description: 'Confluence access token' },
    pageId: { type: 'string', description: 'Page identifier (canonical param)' },
    spaceId: { type: 'string', description: 'Space identifier' },
    blogPostId: { type: 'string', description: 'Blog post identifier' },
    versionNumber: { type: 'number', description: 'Page version number' },
    accountId: { type: 'string', description: 'Atlassian account ID' },
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
    labelId: { type: 'string', description: 'Label identifier' },
    labelPrefix: { type: 'string', description: 'Label prefix (global, my, team, system)' },
    propertyId: { type: 'string', description: 'Property identifier' },
    blogPostStatus: { type: 'string', description: 'Blog post status (current or draft)' },
    purge: { type: 'boolean', description: 'Permanently delete instead of moving to trash' },
    bodyFormat: { type: 'string', description: 'Body format for comments' },
    limit: { type: 'number', description: 'Maximum number of results' },
    cursor: { type: 'string', description: 'Pagination cursor from previous response' },
    taskId: { type: 'string', description: 'Task identifier' },
    taskStatus: { type: 'string', description: 'Task status (complete or incomplete)' },
    taskAssignedTo: { type: 'string', description: 'Filter tasks by assignee account ID' },
    spaceName: { type: 'string', description: 'Space name for create/update' },
    spaceKey: { type: 'string', description: 'Space key for create' },
    spaceDescription: { type: 'string', description: 'Space description' },
    spacePropertyKey: { type: 'string', description: 'Space property key' },
    spacePropertyValue: { type: 'json', description: 'Space property value' },
    spacePropertyId: { type: 'string', description: 'Space property identifier' },
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
    labelId: { type: 'string', description: 'Label identifier' },
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
    // User Results
    accountId: { type: 'string', description: 'Atlassian account ID' },
    displayName: { type: 'string', description: 'User display name' },
    email: { type: 'string', description: 'User email address' },
    accountType: { type: 'string', description: 'Account type (atlassian, app, customer)' },
    profilePicture: { type: 'string', description: 'Path to user profile picture' },
    publicName: { type: 'string', description: 'User public name' },
    // Task Results
    tasks: { type: 'array', description: 'List of tasks' },
    taskId: { type: 'string', description: 'Task identifier' },
    // Descendant Results
    descendants: { type: 'array', description: 'List of descendant pages' },
    // Permission Results
    permissions: { type: 'array', description: 'List of space permissions' },
    // Space Property Results
    homepageId: { type: 'string', description: 'Space homepage ID' },
    description: { type: 'json', description: 'Space description' },
    // Pagination
    nextCursor: { type: 'string', description: 'Cursor for fetching next page of results' },
  },
}
