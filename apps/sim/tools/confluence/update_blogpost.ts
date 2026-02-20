import type {
  ConfluenceUpdateBlogPostParams,
  ConfluenceUpdateBlogPostResponse,
} from '@/tools/confluence/types'
import { BLOGPOST_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export const confluenceUpdateBlogPostTool: ToolConfig<
  ConfluenceUpdateBlogPostParams,
  ConfluenceUpdateBlogPostResponse
> = {
  id: 'confluence_update_blogpost',
  name: 'Confluence Update Blog Post',
  description: 'Update an existing Confluence blog post title, content, or status.',
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
      description: 'New content for the blog post in Confluence storage format',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Blog post status: current or draft',
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
      blogPostId: params.blogPostId?.trim(),
      title: params.title,
      content: params.content,
      status: params.status,
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
        body: data.body ?? null,
        version: data.version ?? null,
        webUrl: data.webUrl ?? data._links?.webui ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    ...BLOGPOST_ITEM_PROPERTIES,
  },
}
