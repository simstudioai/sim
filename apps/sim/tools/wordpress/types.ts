// Common types for WordPress REST API tools
import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

// Common parameters for all WordPress tools (WordPress.com OAuth)
// Note: accessToken is injected by the OAuth system at runtime, not defined in tool params
export interface WordPressBaseParams {
  siteId: string // WordPress.com site ID or domain (e.g., 12345678 or mysite.wordpress.com)
  accessToken: string // OAuth access token (injected by OAuth system)
}

// WordPress.com API base URL
export const WORDPRESS_COM_API_BASE = 'https://public-api.wordpress.com/wp/v2/sites'

// Post status types
export type PostStatus = 'publish' | 'draft' | 'pending' | 'private' | 'future'

// Comment status types
export type CommentStatus = 'approved' | 'hold' | 'spam' | 'trash'

// ============================================
// POST OPERATIONS
// ============================================

// Create Post
export interface WordPressCreatePostParams extends WordPressBaseParams {
  title: string
  content?: string
  status?: PostStatus
  excerpt?: string
  categories?: string // Comma-separated category IDs
  tags?: string // Comma-separated tag IDs
  featuredMedia?: number
  slug?: string
}

export interface WordPressPost {
  id: number
  date: string
  modified: string
  slug: string
  status: PostStatus
  type: string
  link: string
  title: {
    rendered: string
  }
  content: {
    rendered: string
  }
  excerpt: {
    rendered: string
  }
  author: number
  featured_media: number
  categories: number[]
  tags: number[]
}

export interface WordPressCreatePostResponse extends ToolResponse {
  output: {
    post: WordPressPost
  }
}

// Update Post
export interface WordPressUpdatePostParams extends WordPressBaseParams {
  postId: number
  title?: string
  content?: string
  status?: PostStatus
  excerpt?: string
  categories?: string
  tags?: string
  featuredMedia?: number
  slug?: string
}

export interface WordPressUpdatePostResponse extends ToolResponse {
  output: {
    post: WordPressPost
  }
}

// Delete Post
export interface WordPressDeletePostParams extends WordPressBaseParams {
  postId: number
  force?: boolean // Bypass trash and force delete
}

export interface WordPressDeletePostResponse extends ToolResponse {
  output: {
    deleted: boolean
    post: WordPressPost
  }
}

// Get Post
export interface WordPressGetPostParams extends WordPressBaseParams {
  postId: number
}

export interface WordPressGetPostResponse extends ToolResponse {
  output: {
    post: WordPressPost
  }
}

// List Posts
export interface WordPressListPostsParams extends WordPressBaseParams {
  perPage?: number
  page?: number
  status?: PostStatus
  author?: number
  categories?: string
  tags?: string
  search?: string
  orderBy?: 'date' | 'id' | 'title' | 'slug' | 'modified'
  order?: 'asc' | 'desc'
}

export interface WordPressListPostsResponse extends ToolResponse {
  output: {
    posts: WordPressPost[]
    total: number
    totalPages: number
  }
}

// Search Posts
export interface WordPressSearchPostsParams extends WordPressBaseParams {
  query: string
  perPage?: number
  page?: number
}

export interface WordPressSearchPostsResponse extends ToolResponse {
  output: {
    posts: WordPressPost[]
    total: number
    totalPages: number
  }
}

// ============================================
// PAGE OPERATIONS
// ============================================

// Create Page
export interface WordPressCreatePageParams extends WordPressBaseParams {
  title: string
  content?: string
  status?: PostStatus
  excerpt?: string
  parent?: number
  menuOrder?: number
  featuredMedia?: number
  slug?: string
}

export interface WordPressPage {
  id: number
  date: string
  modified: string
  slug: string
  status: PostStatus
  type: string
  link: string
  title: {
    rendered: string
  }
  content: {
    rendered: string
  }
  excerpt: {
    rendered: string
  }
  author: number
  featured_media: number
  parent: number
  menu_order: number
}

export interface WordPressCreatePageResponse extends ToolResponse {
  output: {
    page: WordPressPage
  }
}

// Update Page
export interface WordPressUpdatePageParams extends WordPressBaseParams {
  pageId: number
  title?: string
  content?: string
  status?: PostStatus
  excerpt?: string
  parent?: number
  menuOrder?: number
  featuredMedia?: number
  slug?: string
}

export interface WordPressUpdatePageResponse extends ToolResponse {
  output: {
    page: WordPressPage
  }
}

// Delete Page
export interface WordPressDeletePageParams extends WordPressBaseParams {
  pageId: number
  force?: boolean
}

export interface WordPressDeletePageResponse extends ToolResponse {
  output: {
    deleted: boolean
    page: WordPressPage
  }
}

// Get Page
export interface WordPressGetPageParams extends WordPressBaseParams {
  pageId: number
}

export interface WordPressGetPageResponse extends ToolResponse {
  output: {
    page: WordPressPage
  }
}

// List Pages
export interface WordPressListPagesParams extends WordPressBaseParams {
  perPage?: number
  page?: number
  status?: PostStatus
  parent?: number
  search?: string
  orderBy?: 'date' | 'id' | 'title' | 'slug' | 'modified' | 'menu_order'
  order?: 'asc' | 'desc'
}

export interface WordPressListPagesResponse extends ToolResponse {
  output: {
    pages: WordPressPage[]
    total: number
    totalPages: number
  }
}

// ============================================
// MEDIA OPERATIONS
// ============================================

// Upload Media
export interface WordPressUploadMediaParams extends WordPressBaseParams {
  file: UserFile
  filename?: string // Optional filename override
  title?: string
  caption?: string
  altText?: string
  description?: string
}

export interface WordPressMedia {
  id: number
  date: string
  slug: string
  type: string
  link: string
  title: {
    rendered: string
  }
  caption: {
    rendered: string
  }
  alt_text: string
  media_type: string
  mime_type: string
  source_url: string
  media_details?: {
    width?: number
    height?: number
    file?: string
  }
}

export interface WordPressUploadMediaResponse extends ToolResponse {
  output: {
    media: WordPressMedia
  }
}

// Get Media
export interface WordPressGetMediaParams extends WordPressBaseParams {
  mediaId: number
}

export interface WordPressGetMediaResponse extends ToolResponse {
  output: {
    media: WordPressMedia
  }
}

// List Media
export interface WordPressListMediaParams extends WordPressBaseParams {
  perPage?: number
  page?: number
  search?: string
  mediaType?: 'image' | 'video' | 'audio' | 'application'
  mimeType?: string
  orderBy?: 'date' | 'id' | 'title' | 'slug'
  order?: 'asc' | 'desc'
}

export interface WordPressListMediaResponse extends ToolResponse {
  output: {
    media: WordPressMedia[]
    total: number
    totalPages: number
  }
}

// Delete Media
export interface WordPressDeleteMediaParams extends WordPressBaseParams {
  mediaId: number
  force?: boolean
}

export interface WordPressDeleteMediaResponse extends ToolResponse {
  output: {
    deleted: boolean
    media: WordPressMedia
  }
}

// ============================================
// COMMENT OPERATIONS
// ============================================

// Create Comment
export interface WordPressCreateCommentParams extends WordPressBaseParams {
  postId: number
  content: string
  parent?: number
  authorName?: string
  authorEmail?: string
  authorUrl?: string
}

export interface WordPressComment {
  id: number
  post: number
  parent: number
  author: number
  author_name: string
  author_email?: string
  author_url: string
  date: string
  content: {
    rendered: string
  }
  link: string
  status: string
}

export interface WordPressCreateCommentResponse extends ToolResponse {
  output: {
    comment: WordPressComment
  }
}

// Get Comment
export interface WordPressGetCommentParams extends WordPressBaseParams {
  commentId: number
}

export interface WordPressGetCommentResponse extends ToolResponse {
  output: {
    comment: WordPressComment
  }
}

// List Comments
export interface WordPressListCommentsParams extends WordPressBaseParams {
  perPage?: number
  page?: number
  postId?: number
  status?: CommentStatus
  search?: string
  orderBy?: 'date' | 'id' | 'parent'
  order?: 'asc' | 'desc'
}

export interface WordPressListCommentsResponse extends ToolResponse {
  output: {
    comments: WordPressComment[]
    total: number
    totalPages: number
  }
}

// Update Comment
export interface WordPressUpdateCommentParams extends WordPressBaseParams {
  commentId: number
  content?: string
  status?: CommentStatus
}

export interface WordPressUpdateCommentResponse extends ToolResponse {
  output: {
    comment: WordPressComment
  }
}

// Delete Comment
export interface WordPressDeleteCommentParams extends WordPressBaseParams {
  commentId: number
  force?: boolean
}

export interface WordPressDeleteCommentResponse extends ToolResponse {
  output: {
    deleted: boolean
    comment: WordPressComment
  }
}

// ============================================
// TAXONOMY OPERATIONS (Categories & Tags)
// ============================================

// Create Category
export interface WordPressCreateCategoryParams extends WordPressBaseParams {
  name: string
  description?: string
  parent?: number
  slug?: string
}

export interface WordPressCategory {
  id: number
  count: number
  description: string
  link: string
  name: string
  slug: string
  taxonomy: string
  parent: number
}

export interface WordPressCreateCategoryResponse extends ToolResponse {
  output: {
    category: WordPressCategory
  }
}

// List Categories
export interface WordPressListCategoriesParams extends WordPressBaseParams {
  perPage?: number
  page?: number
  search?: string
  order?: 'asc' | 'desc'
}

export interface WordPressListCategoriesResponse extends ToolResponse {
  output: {
    categories: WordPressCategory[]
    total: number
    totalPages: number
  }
}

// Create Tag
export interface WordPressCreateTagParams extends WordPressBaseParams {
  name: string
  description?: string
  slug?: string
}

export interface WordPressTag {
  id: number
  count: number
  description: string
  link: string
  name: string
  slug: string
  taxonomy: string
}

export interface WordPressCreateTagResponse extends ToolResponse {
  output: {
    tag: WordPressTag
  }
}

// List Tags
export interface WordPressListTagsParams extends WordPressBaseParams {
  perPage?: number
  page?: number
  search?: string
  order?: 'asc' | 'desc'
}

export interface WordPressListTagsResponse extends ToolResponse {
  output: {
    tags: WordPressTag[]
    total: number
    totalPages: number
  }
}

// ============================================
// USER OPERATIONS
// ============================================

// Get Current User
export interface WordPressGetCurrentUserParams extends WordPressBaseParams {}

export interface WordPressUser {
  id: number
  username: string
  name: string
  first_name: string
  last_name: string
  email?: string
  url: string
  description: string
  link: string
  slug: string
  roles: string[]
  avatar_urls?: Record<string, string>
}

export interface WordPressGetCurrentUserResponse extends ToolResponse {
  output: {
    user: WordPressUser
  }
}

// List Users
export interface WordPressListUsersParams extends WordPressBaseParams {
  perPage?: number
  page?: number
  search?: string
  roles?: string
  order?: 'asc' | 'desc'
}

export interface WordPressListUsersResponse extends ToolResponse {
  output: {
    users: WordPressUser[]
    total: number
    totalPages: number
  }
}

// Get User
export interface WordPressGetUserParams extends WordPressBaseParams {
  userId: number
}

export interface WordPressGetUserResponse extends ToolResponse {
  output: {
    user: WordPressUser
  }
}

// ============================================
// SEARCH OPERATIONS
// ============================================

// Search Content
export interface WordPressSearchContentParams extends WordPressBaseParams {
  query: string
  perPage?: number
  page?: number
  type?: 'post' | 'page' | 'attachment'
  subtype?: string
}

export interface WordPressSearchResult {
  id: number
  title: string
  url: string
  type: string
  subtype: string
}

export interface WordPressSearchContentResponse extends ToolResponse {
  output: {
    results: WordPressSearchResult[]
    total: number
    totalPages: number
  }
}

// Union type for all WordPress responses
export type WordPressResponse =
  | WordPressCreatePostResponse
  | WordPressUpdatePostResponse
  | WordPressDeletePostResponse
  | WordPressGetPostResponse
  | WordPressListPostsResponse
  | WordPressSearchPostsResponse
  | WordPressCreatePageResponse
  | WordPressUpdatePageResponse
  | WordPressDeletePageResponse
  | WordPressGetPageResponse
  | WordPressListPagesResponse
  | WordPressUploadMediaResponse
  | WordPressGetMediaResponse
  | WordPressListMediaResponse
  | WordPressDeleteMediaResponse
  | WordPressCreateCommentResponse
  | WordPressGetCommentResponse
  | WordPressListCommentsResponse
  | WordPressUpdateCommentResponse
  | WordPressDeleteCommentResponse
  | WordPressCreateCategoryResponse
  | WordPressListCategoriesResponse
  | WordPressCreateTagResponse
  | WordPressListTagsResponse
  | WordPressGetCurrentUserResponse
  | WordPressListUsersResponse
  | WordPressGetUserResponse
  | WordPressSearchContentResponse
