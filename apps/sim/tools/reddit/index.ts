import { getCommentsTool } from '@/tools/reddit/get_comments'
import { getPostsTool } from '@/tools/reddit/get_posts'
import { hotPostsTool } from '@/tools/reddit/hot_posts'

export const redditHotPostsTool = hotPostsTool
export const redditGetPostsTool = getPostsTool
export const redditGetCommentsTool = getCommentsTool
