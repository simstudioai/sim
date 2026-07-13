import {
  BUFFER_API_URL,
  BUFFER_IDEA_SELECTION,
  type BufferGetIdeasParams,
  type BufferIdeasResponse,
  bufferHeaders,
  IDEA_OUTPUT_PROPERTIES,
  mapBufferIdea,
  PAGE_INFO_OUTPUT_PROPERTIES,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const GET_IDEAS_QUERY = `
  query GetIdeas($input: IdeasInput!, $first: Int, $after: String) {
    ideas(input: $input, first: $first, after: $after) {
      edges {
        node {
          ${BUFFER_IDEA_SELECTION}
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

export const bufferGetIdeasTool: ToolConfig<BufferGetIdeasParams, BufferIdeasResponse> = {
  id: 'buffer_get_ideas',
  name: 'Buffer Get Ideas',
  description: 'List content ideas saved in a Buffer organization',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of ideas to return (default 20)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous page (pageInfo.endCursor)',
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: GET_IDEAS_QUERY,
      variables: {
        input: { organizationId: params.organizationId },
        first: params.limit ?? DEFAULT_LIMIT,
        after: params.after || null,
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    const ideas = data.ideas ?? {}
    return {
      success: true,
      output: {
        ideas: (ideas.edges ?? []).map((edge: Record<string, any>) => mapBufferIdea(edge.node)),
        pageInfo: {
          hasNextPage: ideas.pageInfo?.hasNextPage ?? false,
          endCursor: ideas.pageInfo?.endCursor ?? null,
        },
      },
    }
  },

  outputs: {
    ideas: {
      type: 'array',
      description: 'Content ideas in the organization',
      items: { type: 'object', properties: IDEA_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination info for fetching the next page',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
