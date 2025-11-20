import { deleteTool } from '@/tools/reddit/delete'
import { editTool } from '@/tools/reddit/edit'
import { getCommentsTool } from '@/tools/reddit/get_comments'
import { getControversialTool } from '@/tools/reddit/get_controversial'
import { getPostsTool } from '@/tools/reddit/get_posts'
import { hotPostsTool } from '@/tools/reddit/hot_posts'
import { replyTool } from '@/tools/reddit/reply'
import { saveTool, unsaveTool } from '@/tools/reddit/save'
import { searchTool } from '@/tools/reddit/search'
import { submitPostTool } from '@/tools/reddit/submit_post'
import { subscribeTool } from '@/tools/reddit/subscribe'
import { voteTool } from '@/tools/reddit/vote'

export const redditHotPostsTool = hotPostsTool
export const redditGetPostsTool = getPostsTool
export const redditGetCommentsTool = getCommentsTool
export const redditGetControversialTool = getControversialTool
export const redditSearchTool = searchTool
export const redditSubmitPostTool = submitPostTool
export const redditVoteTool = voteTool
export const redditSaveTool = saveTool
export const redditUnsaveTool = unsaveTool
export const redditReplyTool = replyTool
export const redditEditTool = editTool
export const redditDeleteTool = deleteTool
export const redditSubscribeTool = subscribeTool
