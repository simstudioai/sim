import { TIMESTAMP_OUTPUT, VERSION_OUTPUT_PROPERTIES } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListBlogPostsParams {
  accessToken: string
  domain: string
  limit?: number
  status?: string
  sort?: string
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListBlogPostsResponse {
  success: boolean
  output: {
    ts: string
    blogPosts: Array<{
      id: string
      title: string
      status: string | null
      spaceId: string | null
      authorId: string | null
      createdAt: string | null
      version: {
        number: number
        message?: string
        createdAt?: string
      } | null
      webUrl: string | null
    }>
    nextCursor: string | null
  }
}

export const confluenceListBlogPostsTool: ToolConfig<
  ConfluenceListBlogPostsParams,
  ConfluenceListBlogPostsResponse
> = {
  id: 'confluence_list_blogposts',
  name: 'Confluence List Blog Posts',
  description: 'List all blog posts across all accessible Confluence spaces.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of blog posts to return (default: 25, max: 250)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status: current, archived, trashed, or draft',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order: created-date, -created-date, modified-date, -modified-date, title, -title',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: ConfluenceListBlogPostsParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        limit: String(params.limit || 25),
      })
      if (params.status) {
        query.set('status', params.status)
      }
      if (params.sort) {
        query.set('sort', params.sort)
      }
      if (params.cursor) {
        query.set('cursor', params.cursor)
      }
      if (params.cloudId) {
        query.set('cloudId', params.cloudId)
      }
      return `/api/tools/confluence/blogposts?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListBlogPostsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        blogPosts: data.blogPosts ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    blogPosts: {
      type: 'array',
      description: 'Array of blog posts',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Blog post ID' },
          title: { type: 'string', description: 'Blog post title' },
          status: { type: 'string', description: 'Blog post status', optional: true },
          spaceId: { type: 'string', description: 'Space ID', optional: true },
          authorId: { type: 'string', description: 'Author account ID', optional: true },
          createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
          version: {
            type: 'object',
            description: 'Version information',
            properties: VERSION_OUTPUT_PROPERTIES,
            optional: true,
          },
          webUrl: { type: 'string', description: 'URL to view the blog post', optional: true },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
