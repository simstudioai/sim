import {
  BUFFER_API_URL,
  BUFFER_POST_SELECTION,
  BUFFER_POST_STATUSES,
  type BufferGetPostsParams,
  type BufferPostsResponse,
  bufferHeaders,
  mapBufferPost,
  PAGE_INFO_OUTPUT_PROPERTIES,
  POST_OUTPUT_PROPERTIES,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const GET_POSTS_QUERY = `
  query GetPosts($input: PostsInput!, $first: Int, $after: String) {
    posts(input: $input, first: $first, after: $after) {
      edges {
        node {
          ${BUFFER_POST_SELECTION}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

const DEFAULT_LIMIT = 20

/**
 * Splits a comma-separated string into trimmed, non-empty values.
 */
function splitCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export const bufferGetPostsTool: ToolConfig<BufferGetPostsParams, BufferPostsResponse> = {
  id: 'buffer_get_posts',
  name: 'Buffer Get Posts',
  description:
    'List posts in a Buffer organization, optionally filtered by channel and status (draft, needs_approval, scheduled, sending, sent, error)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key',
    },
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Buffer organization ID (find it with the Get Account operation)',
    },
    channelIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated channel IDs to filter by',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated statuses to filter by: draft, needs_approval, scheduled, sending, sent, error',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of posts to return (default 20)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous page (pageInfo.endCursor)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to sort by: dueAt or createdAt (default dueAt)',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc (default asc)',
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => {
      const input: Record<string, unknown> = { organizationId: params.organizationId }

      const filter: Record<string, unknown> = {}
      if (params.channelIds) {
        const channelIds = splitCommaSeparated(params.channelIds)
        if (channelIds.length > 0) filter.channelIds = channelIds
      }
      if (params.status) {
        const statuses = splitCommaSeparated(params.status)
        const invalid = statuses.filter(
          (status) => !(BUFFER_POST_STATUSES as readonly string[]).includes(status)
        )
        if (invalid.length > 0) {
          throw new Error(
            `Invalid post status "${invalid[0]}". Valid statuses: ${BUFFER_POST_STATUSES.join(', ')}`
          )
        }
        if (statuses.length > 0) filter.status = statuses
      }
      if (Object.keys(filter).length > 0) input.filter = filter

      const sortBy = params.sortBy || 'dueAt'
      if (!['dueAt', 'createdAt'].includes(sortBy)) {
        throw new Error('sortBy must be either "dueAt" or "createdAt"')
      }
      const sortDirection = params.sortDirection || 'asc'
      if (!['asc', 'desc'].includes(sortDirection)) {
        throw new Error('sortDirection must be either "asc" or "desc"')
      }
      input.sort = [{ field: sortBy, direction: sortDirection }]

      return {
        query: GET_POSTS_QUERY,
        variables: {
          input,
          first: params.limit ?? DEFAULT_LIMIT,
          after: params.after || null,
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    const posts = data.posts ?? {}
    return {
      success: true,
      output: {
        posts: (posts.edges ?? []).map((edge: Record<string, any>) => mapBufferPost(edge.node)),
        pageInfo: {
          hasNextPage: posts.pageInfo?.hasNextPage ?? false,
          endCursor: posts.pageInfo?.endCursor ?? null,
        },
      },
    }
  },

  outputs: {
    posts: {
      type: 'array',
      description: 'Posts matching the filters',
      items: { type: 'object', properties: POST_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination info for fetching the next page',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
