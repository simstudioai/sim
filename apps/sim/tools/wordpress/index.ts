// WordPress tools exports
import { createCategoryTool } from '@/tools/wordpress/create_category'
import { createCommentTool } from '@/tools/wordpress/create_comment'
import { createPageTool } from '@/tools/wordpress/create_page'
import { createPostTool } from '@/tools/wordpress/create_post'
import { createTagTool } from '@/tools/wordpress/create_tag'
import { deleteCommentTool } from '@/tools/wordpress/delete_comment'
import { deleteMediaTool } from '@/tools/wordpress/delete_media'
import { deletePageTool } from '@/tools/wordpress/delete_page'
import { deletePostTool } from '@/tools/wordpress/delete_post'
import { getCurrentUserTool } from '@/tools/wordpress/get_current_user'
import { getMediaTool } from '@/tools/wordpress/get_media'
import { getPageTool } from '@/tools/wordpress/get_page'
import { getPostTool } from '@/tools/wordpress/get_post'
import { getUserTool } from '@/tools/wordpress/get_user'
import { listCategoriesTool } from '@/tools/wordpress/list_categories'
import { listCommentsTool } from '@/tools/wordpress/list_comments'
import { listMediaTool } from '@/tools/wordpress/list_media'
import { listPagesTool } from '@/tools/wordpress/list_pages'
import { listPostsTool } from '@/tools/wordpress/list_posts'
import { listTagsTool } from '@/tools/wordpress/list_tags'
import { listUsersTool } from '@/tools/wordpress/list_users'
import { searchContentTool } from '@/tools/wordpress/search_content'
import { updateCommentTool } from '@/tools/wordpress/update_comment'
import { updatePageTool } from '@/tools/wordpress/update_page'
import { updatePostTool } from '@/tools/wordpress/update_post'
import { uploadMediaTool } from '@/tools/wordpress/upload_media'

// Post operations
export const wordpressCreatePostTool = createPostTool
export const wordpressUpdatePostTool = updatePostTool
export const wordpressDeletePostTool = deletePostTool
export const wordpressGetPostTool = getPostTool
export const wordpressListPostsTool = listPostsTool

// Page operations
export const wordpressCreatePageTool = createPageTool
export const wordpressUpdatePageTool = updatePageTool
export const wordpressDeletePageTool = deletePageTool
export const wordpressGetPageTool = getPageTool
export const wordpressListPagesTool = listPagesTool

// Media operations
export const wordpressUploadMediaTool = uploadMediaTool
export const wordpressGetMediaTool = getMediaTool
export const wordpressListMediaTool = listMediaTool
export const wordpressDeleteMediaTool = deleteMediaTool

// Comment operations
export const wordpressCreateCommentTool = createCommentTool
export const wordpressListCommentsTool = listCommentsTool
export const wordpressUpdateCommentTool = updateCommentTool
export const wordpressDeleteCommentTool = deleteCommentTool

// Category operations
export const wordpressCreateCategoryTool = createCategoryTool
export const wordpressListCategoriesTool = listCategoriesTool

// Tag operations
export const wordpressCreateTagTool = createTagTool
export const wordpressListTagsTool = listTagsTool

// User operations
export const wordpressGetCurrentUserTool = getCurrentUserTool
export const wordpressListUsersTool = listUsersTool
export const wordpressGetUserTool = getUserTool

// Search operations
export const wordpressSearchContentTool = searchContentTool
