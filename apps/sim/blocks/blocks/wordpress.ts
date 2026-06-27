import { WordpressIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { WordPressBlockDisplay } from '@/blocks/blocks/wordpress.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { WordPressResponse } from '@/tools/wordpress/types'

export const WordPressBlock: BlockConfig<WordPressResponse> = {
  ...WordPressBlockDisplay,
  authMode: AuthMode.OAuth,
  subBlocks: [
    // Operation Selection
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Posts
        { label: 'Create Post', id: 'wordpress_create_post' },
        { label: 'Update Post', id: 'wordpress_update_post' },
        { label: 'Delete Post', id: 'wordpress_delete_post' },
        { label: 'Get Post', id: 'wordpress_get_post' },
        { label: 'List Posts', id: 'wordpress_list_posts' },
        // Pages
        { label: 'Create Page', id: 'wordpress_create_page' },
        { label: 'Update Page', id: 'wordpress_update_page' },
        { label: 'Delete Page', id: 'wordpress_delete_page' },
        { label: 'Get Page', id: 'wordpress_get_page' },
        { label: 'List Pages', id: 'wordpress_list_pages' },
        // Media
        { label: 'Upload Media', id: 'wordpress_upload_media' },
        { label: 'Get Media', id: 'wordpress_get_media' },
        { label: 'List Media', id: 'wordpress_list_media' },
        { label: 'Delete Media', id: 'wordpress_delete_media' },
        // Comments
        { label: 'Create Comment', id: 'wordpress_create_comment' },
        { label: 'List Comments', id: 'wordpress_list_comments' },
        { label: 'Update Comment', id: 'wordpress_update_comment' },
        { label: 'Delete Comment', id: 'wordpress_delete_comment' },
        // Categories
        { label: 'Create Category', id: 'wordpress_create_category' },
        { label: 'List Categories', id: 'wordpress_list_categories' },
        // Tags
        { label: 'Create Tag', id: 'wordpress_create_tag' },
        { label: 'List Tags', id: 'wordpress_list_tags' },
        // Users
        { label: 'Get Current User', id: 'wordpress_get_current_user' },
        { label: 'List Users', id: 'wordpress_list_users' },
        { label: 'Get User', id: 'wordpress_get_user' },
        // Search
        { label: 'Search Content', id: 'wordpress_search_content' },
      ],
      value: () => 'wordpress_create_post',
    },

    // Credential selector for OAuth
    {
      id: 'credential',
      title: 'WordPress Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'wordpress',
      requiredScopes: getScopesForService('wordpress'),
      placeholder: 'Select WordPress account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'WordPress Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    // Site ID for WordPress.com (required for OAuth)
    {
      id: 'siteId',
      title: 'Site ID or Domain',
      type: 'short-input',
      placeholder: 'e.g., 12345678 or yoursite.wordpress.com',
      description: 'Your WordPress.com site ID or domain. Find it in Settings → General.',
      required: true,
    },

    // Post Operations - Post ID
    {
      id: 'postId',
      title: 'Post ID',
      type: 'short-input',
      placeholder: 'Enter post ID',
      condition: {
        field: 'operation',
        value: ['wordpress_update_post', 'wordpress_delete_post', 'wordpress_get_post'],
      },
      required: {
        field: 'operation',
        value: ['wordpress_update_post', 'wordpress_delete_post', 'wordpress_get_post'],
      },
    },

    // Post/Page Title
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Post or page title',
      condition: {
        field: 'operation',
        value: [
          'wordpress_create_post',
          'wordpress_update_post',
          'wordpress_create_page',
          'wordpress_update_page',
        ],
      },
      required: {
        field: 'operation',
        value: ['wordpress_create_post', 'wordpress_create_page'],
      },
    },

    // Post/Page Content
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Post or page content (HTML or plain text)',
      condition: {
        field: 'operation',
        value: [
          'wordpress_create_post',
          'wordpress_update_post',
          'wordpress_create_page',
          'wordpress_update_page',
        ],
      },
    },

    // Post/Page Status
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Publish', id: 'publish' },
        { label: 'Draft', id: 'draft' },
        { label: 'Pending', id: 'pending' },
        { label: 'Private', id: 'private' },
      ],
      value: () => 'publish',
      condition: {
        field: 'operation',
        value: [
          'wordpress_create_post',
          'wordpress_update_post',
          'wordpress_create_page',
          'wordpress_update_page',
        ],
      },
    },

    // Excerpt (for posts and pages)
    {
      id: 'excerpt',
      title: 'Excerpt',
      type: 'long-input',
      placeholder: 'Post or page excerpt',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_create_post',
          'wordpress_update_post',
          'wordpress_create_page',
          'wordpress_update_page',
        ],
      },
    },

    // Slug (for posts and pages)
    {
      id: 'slug',
      title: 'Slug',
      type: 'short-input',
      placeholder: 'URL slug (optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_create_post',
          'wordpress_update_post',
          'wordpress_create_page',
          'wordpress_update_page',
        ],
      },
    },

    // Categories (for posts only)
    {
      id: 'categories',
      title: 'Categories',
      type: 'short-input',
      placeholder: 'Comma-separated category IDs',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['wordpress_create_post', 'wordpress_update_post'],
      },
    },

    // Tags (for posts only)
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['wordpress_create_post', 'wordpress_update_post'],
      },
    },

    // Featured Media ID
    {
      id: 'featuredMedia',
      title: 'Featured Image ID',
      type: 'short-input',
      placeholder: 'Media ID for featured image',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_create_post',
          'wordpress_update_post',
          'wordpress_create_page',
          'wordpress_update_page',
        ],
      },
    },

    // Page-specific: Page ID
    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      placeholder: 'Enter page ID',
      condition: {
        field: 'operation',
        value: ['wordpress_update_page', 'wordpress_delete_page', 'wordpress_get_page'],
      },
      required: {
        field: 'operation',
        value: ['wordpress_update_page', 'wordpress_delete_page', 'wordpress_get_page'],
      },
    },

    // Page-specific: Parent Page
    {
      id: 'parent',
      title: 'Parent Page ID',
      type: 'short-input',
      placeholder: 'Parent page ID (for hierarchy)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['wordpress_create_page', 'wordpress_update_page'],
      },
    },

    // Page-specific: Menu Order
    {
      id: 'menuOrder',
      title: 'Menu Order',
      type: 'short-input',
      placeholder: 'Order in menu (number)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['wordpress_create_page', 'wordpress_update_page'],
      },
    },

    // Media Operations - File upload (basic mode)
    {
      id: 'fileUpload',
      title: 'Upload File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a media file to WordPress',
      condition: { field: 'operation', value: 'wordpress_upload_media' },
      mode: 'basic',
      multiple: false,
      required: false,
    },
    // Variable reference (advanced mode) - for referencing files from previous blocks
    {
      id: 'file',
      title: 'File Reference',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous block (e.g., {{block_name.file}})',
      condition: { field: 'operation', value: 'wordpress_upload_media' },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'filename',
      title: 'Filename Override',
      type: 'short-input',
      placeholder: 'Optional: Override filename (e.g., image.jpg)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_upload_media' },
    },
    {
      id: 'mediaTitle',
      title: 'Media Title',
      type: 'short-input',
      placeholder: 'Title for the media',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_upload_media' },
    },
    {
      id: 'caption',
      title: 'Caption',
      type: 'short-input',
      placeholder: 'Media caption',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_upload_media' },
    },
    {
      id: 'altText',
      title: 'Alt Text',
      type: 'short-input',
      placeholder: 'Alternative text for accessibility',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_upload_media' },
    },
    {
      id: 'mediaId',
      title: 'Media ID',
      type: 'short-input',
      placeholder: 'Enter media ID',
      condition: {
        field: 'operation',
        value: ['wordpress_get_media', 'wordpress_delete_media'],
      },
      required: {
        field: 'operation',
        value: ['wordpress_get_media', 'wordpress_delete_media'],
      },
    },
    {
      id: 'mediaType',
      title: 'Media Type',
      type: 'dropdown',
      options: [
        { label: 'All Types', id: '' },
        { label: 'Image', id: 'image' },
        { label: 'Video', id: 'video' },
        { label: 'Audio', id: 'audio' },
        { label: 'Application', id: 'application' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_list_media' },
    },

    // Comment Operations
    {
      id: 'commentPostId',
      title: 'Post ID',
      type: 'short-input',
      placeholder: 'Post ID to comment on',
      condition: { field: 'operation', value: 'wordpress_create_comment' },
      required: { field: 'operation', value: 'wordpress_create_comment' },
    },
    {
      id: 'commentContent',
      title: 'Comment Content',
      type: 'long-input',
      placeholder: 'Comment text',
      condition: {
        field: 'operation',
        value: ['wordpress_create_comment', 'wordpress_update_comment'],
      },
      required: { field: 'operation', value: 'wordpress_create_comment' },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Enter comment ID',
      condition: {
        field: 'operation',
        value: ['wordpress_update_comment', 'wordpress_delete_comment'],
      },
      required: {
        field: 'operation',
        value: ['wordpress_update_comment', 'wordpress_delete_comment'],
      },
    },
    {
      id: 'commentStatus',
      title: 'Comment Status',
      type: 'dropdown',
      options: [
        { label: 'Approved', id: 'approved' },
        { label: 'Hold', id: 'hold' },
        { label: 'Spam', id: 'spam' },
        { label: 'Trash', id: 'trash' },
      ],
      value: () => 'approved',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_update_comment' },
    },

    // Category Operations
    {
      id: 'categoryName',
      title: 'Category Name',
      type: 'short-input',
      placeholder: 'Category name',
      condition: { field: 'operation', value: 'wordpress_create_category' },
      required: { field: 'operation', value: 'wordpress_create_category' },
    },
    {
      id: 'categoryDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Category description',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_create_category' },
    },
    {
      id: 'categoryParent',
      title: 'Parent Category ID',
      type: 'short-input',
      placeholder: 'Parent category ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_create_category' },
    },
    {
      id: 'categorySlug',
      title: 'Category Slug',
      type: 'short-input',
      placeholder: 'URL slug (optional)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_create_category' },
    },

    // Tag Operations
    {
      id: 'tagName',
      title: 'Tag Name',
      type: 'short-input',
      placeholder: 'Tag name',
      condition: { field: 'operation', value: 'wordpress_create_tag' },
      required: { field: 'operation', value: 'wordpress_create_tag' },
    },
    {
      id: 'tagDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Tag description',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_create_tag' },
    },
    {
      id: 'tagSlug',
      title: 'Tag Slug',
      type: 'short-input',
      placeholder: 'URL slug (optional)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_create_tag' },
    },

    // User Operations
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID',
      condition: { field: 'operation', value: 'wordpress_get_user' },
      required: { field: 'operation', value: 'wordpress_get_user' },
    },
    {
      id: 'roles',
      title: 'User Roles',
      type: 'short-input',
      placeholder: 'Comma-separated role names (e.g., administrator, editor)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_list_users' },
    },

    // Search Operations
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search keywords',
      condition: { field: 'operation', value: 'wordpress_search_content' },
      required: { field: 'operation', value: 'wordpress_search_content' },
    },
    {
      id: 'searchType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'All Types', id: '' },
        { label: 'Post', id: 'post' },
        { label: 'Page', id: 'page' },
        { label: 'Attachment', id: 'attachment' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'wordpress_search_content' },
    },

    // List Operations - Common Parameters
    {
      id: 'perPage',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '10 (max 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_list_posts',
          'wordpress_list_pages',
          'wordpress_list_media',
          'wordpress_list_comments',
          'wordpress_list_categories',
          'wordpress_list_tags',
          'wordpress_list_users',
          'wordpress_search_content',
        ],
      },
    },
    {
      id: 'page',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_list_posts',
          'wordpress_list_pages',
          'wordpress_list_media',
          'wordpress_list_comments',
          'wordpress_list_categories',
          'wordpress_list_tags',
          'wordpress_list_users',
          'wordpress_search_content',
        ],
      },
    },
    {
      id: 'search',
      title: 'Search Filter',
      type: 'short-input',
      placeholder: 'Search term to filter results',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_list_posts',
          'wordpress_list_pages',
          'wordpress_list_media',
          'wordpress_list_comments',
          'wordpress_list_categories',
          'wordpress_list_tags',
          'wordpress_list_users',
        ],
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'dropdown',
      options: [
        { label: 'Date', id: 'date' },
        { label: 'ID', id: 'id' },
        { label: 'Title', id: 'title' },
        { label: 'Slug', id: 'slug' },
        { label: 'Modified', id: 'modified' },
      ],
      value: () => 'date',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_list_posts',
          'wordpress_list_pages',
          'wordpress_list_media',
          'wordpress_list_comments',
        ],
      },
    },
    {
      id: 'order',
      title: 'Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'desc' },
        { label: 'Ascending', id: 'asc' },
      ],
      value: () => 'desc',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_list_posts',
          'wordpress_list_pages',
          'wordpress_list_media',
          'wordpress_list_comments',
          'wordpress_list_categories',
          'wordpress_list_tags',
          'wordpress_list_users',
        ],
      },
    },

    // List Posts - Status filter
    {
      id: 'listStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Published', id: 'publish' },
        { label: 'Draft', id: 'draft' },
        { label: 'Pending', id: 'pending' },
        { label: 'Private', id: 'private' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['wordpress_list_posts', 'wordpress_list_pages'],
      },
    },

    // Delete Operations - Force delete
    {
      id: 'force',
      title: 'Force Delete',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'wordpress_delete_post',
          'wordpress_delete_page',
          'wordpress_delete_media',
          'wordpress_delete_comment',
        ],
      },
    },
  ],
  tools: {
    access: [
      'wordpress_create_post',
      'wordpress_update_post',
      'wordpress_delete_post',
      'wordpress_get_post',
      'wordpress_list_posts',
      'wordpress_create_page',
      'wordpress_update_page',
      'wordpress_delete_page',
      'wordpress_get_page',
      'wordpress_list_pages',
      'wordpress_upload_media',
      'wordpress_get_media',
      'wordpress_list_media',
      'wordpress_delete_media',
      'wordpress_create_comment',
      'wordpress_list_comments',
      'wordpress_update_comment',
      'wordpress_delete_comment',
      'wordpress_create_category',
      'wordpress_list_categories',
      'wordpress_create_tag',
      'wordpress_list_tags',
      'wordpress_get_current_user',
      'wordpress_list_users',
      'wordpress_get_user',
      'wordpress_search_content',
    ],
    config: {
      tool: (params) => params.operation || 'wordpress_create_post',
      params: (params) => {
        // OAuth authentication for WordPress.com
        const baseParams: Record<string, any> = {
          credential: params.oauthCredential,
          siteId: params.siteId,
        }

        switch (params.operation) {
          case 'wordpress_create_post':
            return {
              ...baseParams,
              title: params.title,
              content: params.content,
              status: params.status,
              excerpt: params.excerpt,
              slug: params.slug,
              categories: params.categories,
              tags: params.tags,
              featuredMedia: params.featuredMedia ? Number(params.featuredMedia) : undefined,
            }
          case 'wordpress_update_post':
            return {
              ...baseParams,
              postId: Number(params.postId),
              title: params.title,
              content: params.content,
              status: params.status,
              excerpt: params.excerpt,
              slug: params.slug,
              categories: params.categories,
              tags: params.tags,
              featuredMedia: params.featuredMedia ? Number(params.featuredMedia) : undefined,
            }
          case 'wordpress_delete_post':
            return {
              ...baseParams,
              postId: Number(params.postId),
              force: params.force,
            }
          case 'wordpress_get_post':
            return {
              ...baseParams,
              postId: Number(params.postId),
            }
          case 'wordpress_list_posts':
            return {
              ...baseParams,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
              status: params.listStatus || undefined,
              search: params.search,
              orderBy: params.orderBy,
              order: params.order,
              categories: params.categories,
              tags: params.tags,
            }
          case 'wordpress_create_page':
            return {
              ...baseParams,
              title: params.title,
              content: params.content,
              status: params.status,
              excerpt: params.excerpt,
              slug: params.slug,
              parent: params.parent ? Number(params.parent) : undefined,
              menuOrder: params.menuOrder ? Number(params.menuOrder) : undefined,
              featuredMedia: params.featuredMedia ? Number(params.featuredMedia) : undefined,
            }
          case 'wordpress_update_page':
            return {
              ...baseParams,
              pageId: Number(params.pageId),
              title: params.title,
              content: params.content,
              status: params.status,
              excerpt: params.excerpt,
              slug: params.slug,
              parent: params.parent ? Number(params.parent) : undefined,
              menuOrder: params.menuOrder ? Number(params.menuOrder) : undefined,
              featuredMedia: params.featuredMedia ? Number(params.featuredMedia) : undefined,
            }
          case 'wordpress_delete_page':
            return {
              ...baseParams,
              pageId: Number(params.pageId),
              force: params.force,
            }
          case 'wordpress_get_page':
            return {
              ...baseParams,
              pageId: Number(params.pageId),
            }
          case 'wordpress_list_pages':
            return {
              ...baseParams,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
              status: params.listStatus || undefined,
              search: params.search,
              orderBy: params.orderBy,
              order: params.order,
              parent: params.parent ? Number(params.parent) : undefined,
            }
          case 'wordpress_upload_media':
            // file is the canonical param for both basic (fileUpload) and advanced modes
            return {
              ...baseParams,
              file: normalizeFileInput(params.file, { single: true }),
              filename: params.filename,
              title: params.mediaTitle,
              caption: params.caption,
              altText: params.altText,
            }
          case 'wordpress_get_media':
            return {
              ...baseParams,
              mediaId: Number(params.mediaId),
            }
          case 'wordpress_list_media':
            return {
              ...baseParams,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
              search: params.search,
              mediaType: params.mediaType || undefined,
              orderBy: params.orderBy,
              order: params.order,
            }
          case 'wordpress_delete_media':
            return {
              ...baseParams,
              mediaId: Number(params.mediaId),
              force: params.force,
            }
          case 'wordpress_create_comment':
            return {
              ...baseParams,
              postId: Number(params.commentPostId),
              content: params.commentContent,
            }
          case 'wordpress_list_comments':
            return {
              ...baseParams,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
              postId: params.commentPostId ? Number(params.commentPostId) : undefined,
              search: params.search,
              orderBy: params.orderBy,
              order: params.order,
            }
          case 'wordpress_update_comment':
            return {
              ...baseParams,
              commentId: Number(params.commentId),
              content: params.commentContent,
              status: params.commentStatus,
            }
          case 'wordpress_delete_comment':
            return {
              ...baseParams,
              commentId: Number(params.commentId),
              force: params.force,
            }
          case 'wordpress_create_category':
            return {
              ...baseParams,
              name: params.categoryName,
              description: params.categoryDescription,
              parent: params.categoryParent ? Number(params.categoryParent) : undefined,
              slug: params.categorySlug,
            }
          case 'wordpress_list_categories':
            return {
              ...baseParams,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
              search: params.search,
              order: params.order,
            }
          case 'wordpress_create_tag':
            return {
              ...baseParams,
              name: params.tagName,
              description: params.tagDescription,
              slug: params.tagSlug,
            }
          case 'wordpress_list_tags':
            return {
              ...baseParams,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
              search: params.search,
              order: params.order,
            }
          case 'wordpress_get_current_user':
            return baseParams
          case 'wordpress_list_users':
            return {
              ...baseParams,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
              search: params.search,
              roles: params.roles,
              order: params.order,
            }
          case 'wordpress_get_user':
            return {
              ...baseParams,
              userId: Number(params.userId),
            }
          case 'wordpress_search_content':
            return {
              ...baseParams,
              query: params.query,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
              type: params.searchType || undefined,
            }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'WordPress OAuth credential' },
    siteId: { type: 'string', description: 'WordPress.com site ID or domain' },
    // Post inputs
    postId: { type: 'number', description: 'Post ID' },
    title: { type: 'string', description: 'Post or page title' },
    content: { type: 'string', description: 'Post or page content' },
    status: { type: 'string', description: 'Post or page status' },
    excerpt: { type: 'string', description: 'Post or page excerpt' },
    slug: { type: 'string', description: 'URL slug' },
    categories: { type: 'string', description: 'Category IDs (comma-separated)' },
    tags: { type: 'string', description: 'Tag IDs (comma-separated)' },
    featuredMedia: { type: 'number', description: 'Featured media ID' },
    // Page inputs
    pageId: { type: 'number', description: 'Page ID' },
    parent: { type: 'number', description: 'Parent page ID' },
    menuOrder: { type: 'number', description: 'Menu order' },
    // Media inputs
    file: { type: 'json', description: 'File to upload (UserFile)' },
    filename: { type: 'string', description: 'Optional filename override' },
    mediaTitle: { type: 'string', description: 'Media title' },
    caption: { type: 'string', description: 'Media caption' },
    altText: { type: 'string', description: 'Alt text' },
    mediaId: { type: 'number', description: 'Media ID' },
    mediaType: { type: 'string', description: 'Media type filter' },
    // Comment inputs
    commentPostId: { type: 'number', description: 'Post ID for comment' },
    commentContent: { type: 'string', description: 'Comment content' },
    commentId: { type: 'number', description: 'Comment ID' },
    commentStatus: { type: 'string', description: 'Comment status' },
    // Category inputs
    categoryName: { type: 'string', description: 'Category name' },
    categoryDescription: { type: 'string', description: 'Category description' },
    categoryParent: { type: 'number', description: 'Parent category ID' },
    categorySlug: { type: 'string', description: 'Category slug' },
    // Tag inputs
    tagName: { type: 'string', description: 'Tag name' },
    tagDescription: { type: 'string', description: 'Tag description' },
    tagSlug: { type: 'string', description: 'Tag slug' },
    // User inputs
    userId: { type: 'number', description: 'User ID' },
    roles: { type: 'string', description: 'User roles filter' },
    // Search inputs
    query: { type: 'string', description: 'Search query' },
    searchType: { type: 'string', description: 'Content type filter' },
    // List inputs
    perPage: { type: 'number', description: 'Results per page' },
    page: { type: 'number', description: 'Page number' },
    search: { type: 'string', description: 'Search filter' },
    orderBy: { type: 'string', description: 'Order by field' },
    order: { type: 'string', description: 'Order direction' },
    listStatus: { type: 'string', description: 'Status filter' },
    force: { type: 'boolean', description: 'Force delete' },
    hideEmpty: { type: 'boolean', description: 'Hide empty taxonomies' },
  },
  outputs: {
    // Post outputs
    post: { type: 'json', description: 'Post data' },
    posts: { type: 'json', description: 'List of posts' },
    // Page outputs
    page: { type: 'json', description: 'Page data' },
    pages: { type: 'json', description: 'List of pages' },
    // Media outputs
    media: { type: 'json', description: 'Media data' },
    // Comment outputs
    comment: { type: 'json', description: 'Comment data' },
    comments: { type: 'json', description: 'List of comments' },
    // Category outputs
    category: { type: 'json', description: 'Category data' },
    categories: { type: 'json', description: 'List of categories' },
    // Tag outputs
    tag: { type: 'json', description: 'Tag data' },
    tags: { type: 'json', description: 'List of tags' },
    // User outputs
    user: { type: 'json', description: 'User data' },
    users: { type: 'json', description: 'List of users' },
    // Search outputs
    results: { type: 'json', description: 'Search results' },
    // Common outputs
    deleted: { type: 'boolean', description: 'Deletion status' },
    total: { type: 'number', description: 'Total count' },
    totalPages: { type: 'number', description: 'Total pages' },
  },
}

export const WordPressBlockMeta = {
  tags: ['content-management', 'seo'],
  url: 'https://wordpress.org',
  templates: [
    {
      icon: WordpressIcon,
      title: 'Blog auto-publisher',
      prompt:
        'Build a workflow that takes a draft document, optimizes it for SEO by researching target keywords, formats it for WordPress with proper headings and meta description, and publishes it as a draft post for final review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress release-notes publisher',
      prompt:
        'Create a scheduled workflow that runs every Friday, pulls merged GitHub PRs for the week, drafts a user-facing changelog, and publishes it as a WordPress post.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'engineering'],
      alsoIntegrations: ['github'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress comment moderator',
      prompt:
        'Build a scheduled workflow that polls new WordPress comments, classifies each as spam, question, or constructive, auto-moderates spam, and replies to questions using a knowledge base.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress SEO refresher',
      prompt:
        'Create a scheduled monthly workflow that finds underperforming WordPress posts, runs Ahrefs keyword analysis, drafts refreshed sections, and stages the update as a draft revision.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['ahrefs'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress newsletter republisher',
      prompt:
        'Build a workflow that publishes a new WordPress post and then drafts an adapted Mailchimp newsletter version, links back to the post, and queues it for the editor’s review.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['mailchimp'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress broken-link sweeper',
      prompt:
        'Create a scheduled workflow that scans WordPress posts for broken outbound links, proposes replacement URLs via web search, and stages each as a draft revision for approval.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: WordpressIcon,
      title: 'WordPress media-rich post builder',
      prompt:
        'Build a workflow that takes a draft article and its image files, uploads each image to the WordPress media library, generates a hero image with an image generator, assigns the right categories and tags, and publishes the fully illustrated post as a draft for review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content', 'automation'],
    },
  ],
  skills: [
    {
      name: 'publish-blog-post',
      description:
        'Create a WordPress post from a draft, assign categories and tags, and set its publish state.',
      content:
        '# Publish a WordPress Post\n\nTurn a finished draft into a WordPress post.\n\n## Steps\n1. Prepare the title, body HTML, and excerpt for the post.\n2. Resolve or create the categories and tags by listing existing ones and matching by name.\n3. Decide the status: draft for review or publish to go live.\n4. Call the create-post operation with the content, taxonomy, and status.\n\n## Output\nReport the new post ID, status, and the post URL. List the categories and tags applied. If publishing directly, confirm the live link.',
    },
    {
      name: 'update-existing-post',
      description:
        'Find a WordPress post and update its content, status, or taxonomy without overwriting the rest.',
      content:
        '# Update a WordPress Post\n\nApply targeted edits to a published or draft post.\n\n## Steps\n1. Locate the post by ID, or list or search posts and match on title.\n2. Get the current post to know its existing content and metadata.\n3. Build an update containing only the fields that change, such as body, status, or tags.\n4. Call the update-post operation and confirm the change.\n\n## Output\nState which fields changed and the post ID. Confirm the resulting status and URL.',
    },
    {
      name: 'upload-and-attach-media',
      description: 'Upload an image or file to the WordPress media library for use in a post.',
      content:
        '# Upload Media to WordPress\n\nAdd an image or file to the media library.\n\n## Steps\n1. Provide the file to upload along with a descriptive title and alt text.\n2. Call the upload-media operation.\n3. Capture the returned media ID and source URL.\n4. If the media is for a specific post, reference the media ID or URL when creating or updating that post.\n\n## Output\nReturn the media ID, the file URL, and the alt text set. Note whether it was attached to a post.',
    },
    {
      name: 'moderate-comments',
      description:
        'List recent WordPress comments and approve, hold, spam, or trash them by policy.',
      content:
        '# Moderate WordPress Comments\n\nKeep the comment queue clean and on-policy.\n\n## Steps\n1. List comments, optionally filtering by status such as hold.\n2. For each comment, judge it against the moderation policy: legitimate, spam, or abusive.\n3. Update each comment to the right status: approved, hold, spam, or trash.\n\n## Output\nReturn a summary of how many comments were approved, held, marked spam, or trashed, with the comment IDs grouped by action taken.',
    },
  ],
} as const satisfies BlockMeta
