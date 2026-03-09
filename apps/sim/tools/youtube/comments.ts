import type { ToolConfig } from '@/tools/types'
import type { YouTubeCommentsParams, YouTubeCommentsResponse } from '@/tools/youtube/types'

export const youtubeCommentsTool: ToolConfig<YouTubeCommentsParams, YouTubeCommentsResponse> = {
  id: 'youtube_comments',
  name: 'YouTube Video Comments',
  description: 'Get top-level comments from a YouTube video with author details and engagement.',
  version: '1.1.0',
  params: {
    videoId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'YouTube video ID (11-character string, e.g., "dQw4w9WgXcQ")',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 20,
      description: 'Maximum number of comments to return (1-100)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'relevance',
      description: 'Order of comments: "time" (newest first) or "relevance" (most relevant first)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token for pagination (from previous response nextPageToken)',
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
      let url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${encodeURIComponent(params.videoId)}&key=${params.apiKey}`
      url += `&maxResults=${Number(params.maxResults || 20)}`
      url += `&order=${params.order || 'relevance'}`
      if (params.pageToken) {
        url += `&pageToken=${encodeURIComponent(params.pageToken)}`
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

    if (data.error) {
      return {
        success: false,
        output: {
          items: [],
          totalResults: 0,
          nextPageToken: null,
        },
        error: data.error.message || 'Failed to fetch comments',
      }
    }

    const items = (data.items || []).map((item: any) => {
      const topLevelComment = item.snippet?.topLevelComment?.snippet
      return {
        commentId: item.snippet?.topLevelComment?.id ?? item.id ?? '',
        authorDisplayName: topLevelComment?.authorDisplayName ?? '',
        authorChannelUrl: topLevelComment?.authorChannelUrl ?? '',
        authorProfileImageUrl: topLevelComment?.authorProfileImageUrl ?? '',
        textDisplay: topLevelComment?.textDisplay ?? '',
        textOriginal: topLevelComment?.textOriginal ?? '',
        likeCount: Number(topLevelComment?.likeCount || 0),
        publishedAt: topLevelComment?.publishedAt ?? '',
        updatedAt: topLevelComment?.updatedAt ?? '',
        replyCount: Number(item.snippet?.totalReplyCount || 0),
      }
    })

    return {
      success: true,
      output: {
        items,
        totalResults: data.pageInfo?.totalResults || items.length,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of top-level comments from the video',
      items: {
        type: 'object',
        properties: {
          commentId: { type: 'string', description: 'Comment ID' },
          authorDisplayName: { type: 'string', description: 'Comment author display name' },
          authorChannelUrl: { type: 'string', description: 'Comment author channel URL' },
          authorProfileImageUrl: {
            type: 'string',
            description: 'Comment author profile image URL',
          },
          textDisplay: { type: 'string', description: 'Comment text (HTML formatted)' },
          textOriginal: { type: 'string', description: 'Comment text (plain text)' },
          likeCount: { type: 'number', description: 'Number of likes on the comment' },
          publishedAt: { type: 'string', description: 'When the comment was posted' },
          updatedAt: { type: 'string', description: 'When the comment was last edited' },
          replyCount: { type: 'number', description: 'Number of replies to this comment' },
        },
      },
    },
    totalResults: {
      type: 'number',
      description: 'Total number of comment threads available',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for accessing the next page of results',
      optional: true,
    },
  },
}
