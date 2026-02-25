import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceDeleteBlogPostParams {
  accessToken: string
  domain: string
  blogPostId: string
  cloudId?: string
}

export interface ConfluenceDeleteBlogPostResponse {
  success: boolean
  output: {
    ts: string
    blogPostId: string
    deleted: boolean
  }
}

export const confluenceDeleteBlogPostTool: ToolConfig<
  ConfluenceDeleteBlogPostParams,
  ConfluenceDeleteBlogPostResponse
> = {
  id: 'confluence_delete_blogpost',
  name: 'Confluence Delete Blog Post',
  description: 'Delete a Confluence blog post.',
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
      description: 'The ID of the blog post to delete',
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
    method: 'DELETE',
    headers: (params: ConfluenceDeleteBlogPostParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceDeleteBlogPostParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      blogPostId: params.blogPostId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        blogPostId: data.blogPostId ?? '',
        deleted: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    blogPostId: { type: 'string', description: 'Deleted blog post ID' },
    deleted: { type: 'boolean', description: 'Deletion status' },
  },
}
