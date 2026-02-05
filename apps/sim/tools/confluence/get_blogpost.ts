import {
  CONTENT_BODY_OUTPUT_PROPERTIES,
  TIMESTAMP_OUTPUT,
  VERSION_OUTPUT_PROPERTIES,
} from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetBlogPostParams {
  accessToken: string
  domain: string
  blogPostId: string
  bodyFormat?: string
  cloudId?: string
}

export interface ConfluenceGetBlogPostResponse {
  success: boolean
  output: {
    ts: string
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
  }
}

export const confluenceGetBlogPostTool: ToolConfig<
  ConfluenceGetBlogPostParams,
  ConfluenceGetBlogPostResponse
> = {
  id: 'confluence_get_blogpost',
  name: 'Confluence Get Blog Post',
  description: 'Get a specific Confluence blog post by ID, including its content.',
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
    blogPostId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the blog post to retrieve',
    },
    bodyFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Format for blog post body: storage, atlas_doc_format, or view',
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
    url: () => '/api/tools/confluence/blogposts',
    method: 'POST',
    headers: (params: ConfluenceGetBlogPostParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceGetBlogPostParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      blogPostId: params.blogPostId?.trim(),
      bodyFormat: params.bodyFormat || 'storage',
      cloudId: params.cloudId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        id: data.id ?? '',
        title: data.title ?? '',
        status: data.status ?? null,
        spaceId: data.spaceId ?? null,
        authorId: data.authorId ?? null,
        createdAt: data.createdAt ?? null,
        version: data.version ?? null,
        body: data.body ?? null,
        webUrl: data.webUrl ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
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
      description: 'Blog post body content in requested format(s)',
      properties: CONTENT_BODY_OUTPUT_PROPERTIES,
      optional: true,
    },
    webUrl: { type: 'string', description: 'URL to view the blog post', optional: true },
  },
}
