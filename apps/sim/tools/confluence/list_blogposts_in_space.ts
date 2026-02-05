import {
  CONTENT_BODY_OUTPUT_PROPERTIES,
  TIMESTAMP_OUTPUT,
  VERSION_OUTPUT_PROPERTIES,
} from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListBlogPostsInSpaceParams {
  accessToken: string
  domain: string
  spaceId: string
  limit?: number
  status?: string
  bodyFormat?: string
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListBlogPostsInSpaceResponse {
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
      body: {
        storage?: { value: string }
      } | null
      webUrl: string | null
    }>
    nextCursor: string | null
  }
}

export const confluenceListBlogPostsInSpaceTool: ToolConfig<
  ConfluenceListBlogPostsInSpaceParams,
  ConfluenceListBlogPostsInSpaceResponse
> = {
  id: 'confluence_list_blogposts_in_space',
  name: 'Confluence List Blog Posts in Space',
  description: 'List all blog posts within a specific Confluence space.',
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
    spaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the Confluence space to list blog posts from',
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
    bodyFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Format for blog post body: storage, atlas_doc_format, or view',
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
    url: () => '/api/tools/confluence/space-blogposts',
    method: 'POST',
    headers: (params: ConfluenceListBlogPostsInSpaceParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceListBlogPostsInSpaceParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      spaceId: params.spaceId?.trim(),
      limit: params.limit ? Number(params.limit) : 25,
      status: params.status,
      bodyFormat: params.bodyFormat,
      cursor: params.cursor,
      cloudId: params.cloudId,
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
      description: 'Array of blog posts in the space',
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
          body: {
            type: 'object',
            description: 'Blog post body content',
            properties: CONTENT_BODY_OUTPUT_PROPERTIES,
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
