import {
  CONTENT_BODY_OUTPUT_PROPERTIES,
  TIMESTAMP_OUTPUT,
  VERSION_OUTPUT_PROPERTIES,
} from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceCreateBlogPostParams {
  accessToken: string
  domain: string
  spaceId: string
  title: string
  content: string
  status?: string
  cloudId?: string
}

export interface ConfluenceCreateBlogPostResponse {
  success: boolean
  output: {
    ts: string
    id: string
    title: string
    status: string | null
    spaceId: string
    authorId: string | null
    body: Record<string, any> | null
    version: Record<string, any> | null
    webUrl: string | null
  }
}

export const confluenceCreateBlogPostTool: ToolConfig<
  ConfluenceCreateBlogPostParams,
  ConfluenceCreateBlogPostResponse
> = {
  id: 'confluence_create_blogpost',
  name: 'Confluence Create Blog Post',
  description: 'Create a new blog post in a Confluence space.',
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
      description: 'The ID of the space to create the blog post in',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the blog post',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Blog post content in Confluence storage format (HTML)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Blog post status: current (default) or draft',
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
    headers: (params: ConfluenceCreateBlogPostParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceCreateBlogPostParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      spaceId: params.spaceId?.trim(),
      title: params.title,
      content: params.content,
      status: params.status || 'current',
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
        spaceId: data.spaceId ?? '',
        authorId: data.authorId ?? null,
        body: data.body ?? null,
        version: data.version ?? null,
        webUrl: data.webUrl ?? data._links?.webui ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    id: { type: 'string', description: 'Created blog post ID' },
    title: { type: 'string', description: 'Blog post title' },
    status: { type: 'string', description: 'Blog post status', optional: true },
    spaceId: { type: 'string', description: 'Space ID' },
    authorId: { type: 'string', description: 'Author account ID', optional: true },
    body: {
      type: 'object',
      description: 'Blog post body content',
      properties: CONTENT_BODY_OUTPUT_PROPERTIES,
      optional: true,
    },
    version: {
      type: 'object',
      description: 'Blog post version information',
      properties: VERSION_OUTPUT_PROPERTIES,
      optional: true,
    },
    webUrl: { type: 'string', description: 'URL to view the blog post', optional: true },
  },
}
