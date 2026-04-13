import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceUpdateBlogPostParams {
  accessToken: string
  domain: string
  blogPostId: string
  title?: string
  content?: string
  cloudId?: string
}

export interface ConfluenceUpdateBlogPostResponse {
  success: boolean
  output: {
    ts: string
    blogPostId: string
    title: string
    status: string | null
    spaceId: string | null
    version: Record<string, unknown> | null
    url: string
  }
}

export const confluenceUpdateBlogPostTool: ToolConfig<
  ConfluenceUpdateBlogPostParams,
  ConfluenceUpdateBlogPostResponse
> = {
  id: 'confluence_update_blogpost',
  name: 'Confluence Update Blog Post',
  description: 'Update an existing Confluence blog post title and/or content.',
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
      description: 'The ID of the blog post to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the blog post',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New content for the blog post in storage format',
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
    method: 'PUT',
    headers: (params: ConfluenceUpdateBlogPostParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceUpdateBlogPostParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      blogPostId: params.blogPostId,
      title: params.title,
      content: params.content,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        blogPostId: data.id ?? '',
        title: data.title ?? '',
        status: data.status ?? null,
        spaceId: data.spaceId ?? null,
        version: data.version ?? null,
        url: data._links?.webui ?? '',
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    blogPostId: { type: 'string', description: 'Updated blog post ID' },
    title: { type: 'string', description: 'Blog post title' },
    status: { type: 'string', description: 'Blog post status', optional: true },
    spaceId: { type: 'string', description: 'Space ID', optional: true },
    version: { type: 'json', description: 'Version information', optional: true },
    url: { type: 'string', description: 'URL to view the blog post' },
  },
}
