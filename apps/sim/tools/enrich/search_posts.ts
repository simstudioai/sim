import type { EnrichSearchPostsParams, EnrichSearchPostsResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const searchPostsTool: ToolConfig<EnrichSearchPostsParams, EnrichSearchPostsResponse> = {
  id: 'enrich_search_posts',
  name: 'Enrich Search Posts',
  description: 'Search LinkedIn posts by keywords with date filtering.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    keywords: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search keywords (e.g., "AI automation")',
    },
    datePosted: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time filter (e.g., past_week, past_month)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
    },
  },

  request: {
    url: 'https://api.enrich.so/v1/api/search-posts',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        keywords: params.keywords,
      }

      if (params.datePosted) body.date_posted = params.datePosted
      if (params.page) body.page = params.page

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const posts =
      data.data?.map((post: any) => ({
        url: post.url ?? null,
        postId: post.post_id ?? null,
        author: {
          name: post.author?.name ?? null,
          headline: post.author?.headline ?? null,
          linkedInUrl: post.author?.linkedin_url ?? null,
          profileImage: post.author?.profile_image ?? null,
        },
        timestamp: post.post?.timestamp ?? null,
        textContent: post.post?.text_content ?? null,
        hashtags: post.post?.hashtags ?? [],
        mediaUrls: post.post?.post_media_url ?? [],
        reactions: post.engagement?.reactions ?? 0,
        commentsCount: post.engagement?.comments_count ?? 0,
      })) ?? []

    return {
      success: true,
      output: {
        count: data.count ?? posts.length,
        posts,
      },
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Total number of results',
    },
    posts: {
      type: 'array',
      description: 'Search results',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Post URL' },
          postId: { type: 'string', description: 'Post ID' },
          author: {
            type: 'object',
            description: 'Author information',
            properties: {
              name: { type: 'string', description: 'Author name' },
              headline: { type: 'string', description: 'Author headline' },
              linkedInUrl: { type: 'string', description: 'Author LinkedIn URL' },
              profileImage: { type: 'string', description: 'Author profile image' },
            },
          },
          timestamp: { type: 'string', description: 'Post timestamp' },
          textContent: { type: 'string', description: 'Post text content' },
          hashtags: { type: 'array', description: 'Hashtags' },
          mediaUrls: { type: 'array', description: 'Media URLs' },
          reactions: { type: 'number', description: 'Number of reactions' },
          commentsCount: { type: 'number', description: 'Number of comments' },
        },
      },
    },
  },
}
