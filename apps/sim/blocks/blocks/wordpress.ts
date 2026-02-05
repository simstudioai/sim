import { WordpressIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { WordPressResponse } from '@/tools/wordpress/types'

export const WordPressBlock: BlockConfig<WordPressResponse> = {
  type: 'wordpress',
  name: 'WordPress',
  description: 'Manage WordPress content',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate with WordPress to create, update, and manage posts, pages, media, comments, categories, tags, and users. Supports WordPress.com sites via OAuth and self-hosted WordPress sites using Application Passwords authentication.',
  docsLink: 'https://docs.sim.ai/tools/wordpress',
  category: 'tools',
  bgColor: '#21759B',
  icon: WordpressIcon,
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
      serviceId: 'wordpress',
      requiredScopes: ['global'],
      placeholder: 'Select WordPress account',
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
      condition: { field: 'operation', value: 'wordpress_upload_media' },
    },
    {
      id: 'mediaTitle',
      title: 'Media Title',
      type: 'short-input',
      placeholder: 'Title for the media',
      condition: { field: 'operation', value: 'wordpress_upload_media' },
    },
    {
      id: 'caption',
      title: 'Caption',
      type: 'short-input',
      placeholder: 'Media caption',
      condition: { field: 'operation', value: 'wordpress_upload_media' },
    },
    {
      id: 'altText',
      title: 'Alt Text',
      type: 'short-input',
      placeholder: 'Alternative text for accessibility',
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
      condition: { field: 'operation', value: 'wordpress_create_category' },
    },
    {
      id: 'categoryParent',
      title: 'Parent Category ID',
      type: 'short-input',
      placeholder: 'Parent category ID',
      condition: { field: 'operation', value: 'wordpress_create_category' },
    },
    {
      id: 'categorySlug',
      title: 'Category Slug',
      type: 'short-input',
      placeholder: 'URL slug (optional)',
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
      condition: { field: 'operation', value: 'wordpress_create_tag' },
    },
    {
      id: 'tagSlug',
      title: 'Tag Slug',
      type: 'short-input',
      placeholder: 'URL slug (optional)',
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
      condition: { field: 'operation', value: 'wordpress_search_content' },
    },

    // List Operations - Common Parameters
    {
      id: 'perPage',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '10 (max 100)',
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
          credential: params.credential,
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
