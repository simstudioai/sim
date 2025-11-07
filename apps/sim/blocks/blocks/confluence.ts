import { ConfluenceIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ConfluenceResponse } from '@/tools/confluence/types'

export const ConfluenceBlock: BlockConfig<ConfluenceResponse> = {
  type: 'confluence',
  name: 'Confluence',
  description: 'Interact with Confluence',
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
      provider: 'confluence',
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
      ],
      placeholder: 'Select Confluence account',
      required: true,
    },
    {
      id: 'pageId',
      title: 'Select Page',
      type: 'file-selector',
      canonicalParamId: 'pageId',
      provider: 'confluence',
      serviceId: 'confluence',
      placeholder: 'Select Confluence page',
      dependsOn: ['credential', 'domain'],
      mode: 'basic',
    },
    {
      id: 'manualPageId',
      title: 'Page ID',
      type: 'short-input',
      canonicalParamId: 'pageId',
      placeholder: 'Enter Confluence page ID',
      mode: 'advanced',
    },
    {
      id: 'spaceId',
      title: 'Space ID',
      type: 'short-input',
      placeholder: 'Enter Confluence space ID',
      required: true,
      condition: { field: 'operation', value: ['create', 'get_space'] },
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
        const { credential, pageId, manualPageId, operation, ...rest } = params

        const effectivePageId = (pageId || manualPageId || '').trim()

        // Operations that require pageId
        const requiresPageId = [
          'read',
          'update',
          'delete',
          'create_comment',
          'list_comments',
          'list_attachments',
          'list_labels',
        ]

        // Operations that require spaceId
        const requiresSpaceId = ['create', 'get_space']

        if (requiresPageId.includes(operation) && !effectivePageId) {
          throw new Error('Page ID is required. Please select a page or enter a page ID manually.')
        }

        if (requiresSpaceId.includes(operation) && !rest.spaceId) {
          throw new Error('Space ID is required for this operation.')
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
    pageId: { type: 'string', description: 'Page identifier' },
    manualPageId: { type: 'string', description: 'Manual page identifier' },
    spaceId: { type: 'string', description: 'Space identifier' },
    title: { type: 'string', description: 'Page title' },
    content: { type: 'string', description: 'Page content' },
    parentId: { type: 'string', description: 'Parent page identifier' },
    query: { type: 'string', description: 'Search query' },
    comment: { type: 'string', description: 'Comment text' },
    commentId: { type: 'string', description: 'Comment identifier' },
    attachmentId: { type: 'string', description: 'Attachment identifier' },
    labelName: { type: 'string', description: 'Label name' },
    limit: { type: 'number', description: 'Maximum number of results' },
  },
  outputs: {
    ts: { type: 'string', description: 'Timestamp' },
    pageId: { type: 'string', description: 'Page identifier' },
    content: { type: 'string', description: 'Page content' },
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
    labelName: { type: 'string', description: 'Label name' },
    spaceId: { type: 'string', description: 'Space identifier' },
    name: { type: 'string', description: 'Space name' },
    key: { type: 'string', description: 'Space key' },
    type: { type: 'string', description: 'Space or content type' },
    status: { type: 'string', description: 'Space status' },
  },
}
