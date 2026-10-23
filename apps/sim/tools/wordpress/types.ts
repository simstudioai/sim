import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Common parameters for all WordPress.com OAuth tools. `accessToken` is injected by the
 * OAuth system at runtime, not defined in tool params.
 */
interface WordPressBaseParams {
  /** WordPress.com site ID or domain (e.g., 12345678 or mysite.wordpress.com) */
  siteId: string
  /** OAuth access token (injected by OAuth system) */
  accessToken: string
}

export const WORDPRESS_COM_API_BASE = 'https://public-api.wordpress.com/wp/v2/sites'

type PostStatus = 'publish' | 'draft' | 'pending' | 'private' | 'future'

type CommentStatus = 'approved' | 'hold' | 'spam' | 'trash'

export interface WordPressCreatePostParams extends WordPressBaseParams {
  title: string
  content?: string
  status?: PostStatus
  excerpt?: string
  /** Comma-separated category IDs */
  categories?: string
  /** Comma-separated tag IDs */
  tags?: string
  featuredMedia?: number
  slug?: string
}

interface WordPressPost {
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

export interface WordPressDeletePostParams extends WordPressBaseParams {
  postId: number
  /** Bypass trash and force delete */
  force?: boolean
}

export interface WordPressDeletePostResponse extends ToolResponse {
  output: {
    deleted: boolean
    post: WordPressPost
  }
}

export interface WordPressGetPostParams extends WordPressBaseParams {
  postId: number
}

export interface WordPressGetPostResponse extends ToolResponse {
  output: {
    post: WordPressPost
  }
}

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

interface WordPressPage {
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

export interface WordPressGetPageParams extends WordPressBaseParams {
  pageId: number
}

export interface WordPressGetPageResponse extends ToolResponse {
  output: {
    page: WordPressPage
  }
}

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

export interface WordPressUploadMediaParams extends WordPressBaseParams {
  file: UserFile
  /** Optional filename override */
  filename?: string
  title?: string
  caption?: string
  altText?: string
  description?: string
}

interface WordPressMedia {
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

export interface WordPressGetMediaParams extends WordPressBaseParams {
  mediaId: number
}

export interface WordPressGetMediaResponse extends ToolResponse {
  output: {
    media: WordPressMedia
  }
}

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

export interface WordPressDeleteMediaParams extends WordPressBaseParams {
  mediaId: number
}

export interface WordPressDeleteMediaResponse extends ToolResponse {
  output: {
    deleted: boolean
    media: WordPressMedia
  }
}

export interface WordPressCreateCommentParams extends WordPressBaseParams {
  postId: number
  content: string
  parent?: number
  authorName?: string
  authorEmail?: string
  authorUrl?: string
}

interface WordPressComment {
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

export interface WordPressCreateCategoryParams extends WordPressBaseParams {
  name: string
  description?: string
  parent?: number
  slug?: string
}

interface WordPressCategory {
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

export interface WordPressGetCategoryParams extends WordPressBaseParams {
  categoryId: number
}

export interface WordPressGetCategoryResponse extends ToolResponse {
  output: {
    category: WordPressCategory
  }
}

export interface WordPressUpdateCategoryParams extends WordPressBaseParams {
  categoryId: number
  name?: string
  description?: string
  parent?: number
  slug?: string
}

export interface WordPressUpdateCategoryResponse extends ToolResponse {
  output: {
    category: WordPressCategory
  }
}

export interface WordPressDeleteCategoryParams extends WordPressBaseParams {
  categoryId: number
}

export interface WordPressDeleteCategoryResponse extends ToolResponse {
  output: {
    deleted: boolean
    category: WordPressCategory
  }
}

export interface WordPressCreateTagParams extends WordPressBaseParams {
  name: string
  description?: string
  slug?: string
}

interface WordPressTag {
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

export interface WordPressGetTagParams extends WordPressBaseParams {
  tagId: number
}

export interface WordPressGetTagResponse extends ToolResponse {
  output: {
    tag: WordPressTag
  }
}

export interface WordPressUpdateTagParams extends WordPressBaseParams {
  tagId: number
  name?: string
  description?: string
  slug?: string
}

export interface WordPressUpdateTagResponse extends ToolResponse {
  output: {
    tag: WordPressTag
  }
}

export interface WordPressDeleteTagParams extends WordPressBaseParams {
  tagId: number
}

export interface WordPressDeleteTagResponse extends ToolResponse {
  output: {
    deleted: boolean
    tag: WordPressTag
  }
}

export interface WordPressGetCurrentUserParams extends WordPressBaseParams {}

interface WordPressUser {
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

export interface WordPressGetUserParams extends WordPressBaseParams {
  userId: number
}

export interface WordPressGetUserResponse extends ToolResponse {
  output: {
    user: WordPressUser
  }
}

export interface WordPressSearchContentParams extends WordPressBaseParams {
  query: string
  perPage?: number
  page?: number
  type?: 'post' | 'term' | 'post-format'
  subtype?: string
}

interface WordPressSearchResult {
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
