import type { EnrichGetPostDetailsParams, EnrichGetPostDetailsResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const getPostDetailsTool: ToolConfig<
  EnrichGetPostDetailsParams,
  EnrichGetPostDetailsResponse
> = {
  id: 'enrich_get_post_details',
  name: 'Enrich Get Post Details',
  description: 'Get detailed information about a LinkedIn post by URL.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn post URL',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/post-details')
      url.searchParams.append('url', params.url.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        postId: data.PostId ?? null,
        author: {
          name: data.author?.name ?? null,
          headline: data.author?.headline ?? null,
          linkedInUrl: data.author?.linkedin_url ?? null,
          profileImage: data.author?.profile_image ?? null,
        },
        timestamp: data.post?.timestamp ?? null,
        textContent: data.post?.text_content ?? null,
        hashtags: data.post?.hashtags ?? [],
        mediaUrls: data.post?.post_media_url ?? [],
        reactions: data.engagement?.reactions ?? 0,
        commentsCount: data.engagement?.comments_count ?? 0,
      },
    }
  },

  outputs: {
    postId: {
      type: 'string',
      description: 'Post ID',
      optional: true,
    },
    author: {
      type: 'json',
      description: 'Author information',
      properties: {
        name: { type: 'string', description: 'Author name' },
        headline: { type: 'string', description: 'Author headline' },
        linkedInUrl: { type: 'string', description: 'Author LinkedIn URL' },
        profileImage: { type: 'string', description: 'Author profile image' },
      },
    },
    timestamp: {
      type: 'string',
      description: 'Post timestamp',
      optional: true,
    },
    textContent: {
      type: 'string',
      description: 'Post text content',
      optional: true,
    },
    hashtags: {
      type: 'array',
      description: 'Hashtags',
      items: {
        type: 'string',
        description: 'Hashtag',
      },
    },
    mediaUrls: {
      type: 'array',
      description: 'Media URLs',
      items: {
        type: 'string',
        description: 'Media URL',
      },
    },
    reactions: {
      type: 'number',
      description: 'Number of reactions',
    },
    commentsCount: {
      type: 'number',
      description: 'Number of comments',
    },
  },
}
