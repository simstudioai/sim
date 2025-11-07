import type { ToolConfig } from '@/tools/types'
import type { YouTubeCommentsParams, YouTubeCommentsResponse } from '@/tools/youtube/types'

export const youtubeCommentsTool: ToolConfig<YouTubeCommentsParams, YouTubeCommentsResponse> = {
  id: 'youtube_comments',
  name: 'YouTube Video Comments',
  description: 'Get comments from a YouTube video.',
  version: '1.0.0',
  params: {
    videoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube video ID',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      default: 20,
      description: 'Maximum number of comments to return',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      default: 'relevance',
      description: 'Order of comments: time or relevance',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Page token for pagination',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'YouTube API Key',
    },
  },

  request: {
    url: (params: YouTubeCommentsParams) => {
      let url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${params.videoId}&key=${params.apiKey}`
      url += `&maxResults=${Number(params.maxResults || 20)}`
      url += `&order=${params.order || 'relevance'}`
      if (params.pageToken) {
        url += `&pageToken=${params.pageToken}`
      }
      return url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<YouTubeCommentsResponse> => {
    const data = await response.json()

    const items = (data.items || []).map((item: any) => {
      const topLevelComment = item.snippet?.topLevelComment?.snippet
      return {
        commentId: item.snippet?.topLevelComment?.id || item.id,
        authorDisplayName: topLevelComment?.authorDisplayName || '',
        authorChannelUrl: topLevelComment?.authorChannelUrl || '',
        textDisplay: topLevelComment?.textDisplay || '',
        textOriginal: topLevelComment?.textOriginal || '',
        likeCount: topLevelComment?.likeCount || 0,
        publishedAt: topLevelComment?.publishedAt || '',
        updatedAt: topLevelComment?.updatedAt || '',
        replyCount: item.snippet?.totalReplyCount || 0,
      }
    })

    return {
      success: true,
      output: {
        items,
        totalResults: data.pageInfo?.totalResults || 0,
        nextPageToken: data.nextPageToken,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of comments from the video',
      items: {
        type: 'object',
        properties: {
          commentId: { type: 'string', description: 'Comment ID' },
          authorDisplayName: { type: 'string', description: 'Comment author name' },
          authorChannelUrl: { type: 'string', description: 'Comment author channel URL' },
          textDisplay: { type: 'string', description: 'Comment text (HTML formatted)' },
          textOriginal: { type: 'string', description: 'Comment text (plain text)' },
          likeCount: { type: 'number', description: 'Number of likes' },
          publishedAt: { type: 'string', description: 'Comment publish date' },
          updatedAt: { type: 'string', description: 'Comment last updated date' },
          replyCount: { type: 'number', description: 'Number of replies', optional: true },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of comments',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for accessing the next page of results',
      optional: true,
    },
  },
}
