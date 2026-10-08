import { toArray, toRecord } from '@sim/utils/object'
import { bufferInputDescription, bufferSelection, parseBufferInput } from '@/tools/buffer/schema'
import {
  BUFFER_API_URL,
  BUFFER_IDEA_SELECTION,
  type BufferGetIdeasParams,
  type BufferIdeasResponse,
  bufferHeaders,
  bufferPageSize,
  IDEA_OUTPUT_PROPERTIES,
  mapBufferIdea,
  mapBufferPageInfo,
  PAGE_INFO_OUTPUT_PROPERTIES,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const GET_IDEAS_QUERY = `
  query GetIdeas($input: IdeasInput!, $first: Int, $after: String) {
    ideas(input: $input, first: $first, after: $after) {
      edges {
        cursor
        node {
          ${BUFFER_IDEA_SELECTION}
        }
      }
      pageInfo { ${bufferSelection('PaginationPageInfo')}
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
    groupFilter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: bufferInputDescription('IdeasGroupFilter'),
    },
    tagsFilter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: bufferInputDescription('TagComparator'),
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: GET_IDEAS_QUERY,
      variables: {
        input: parseBufferInput('IdeasInput', {
          organizationId: params.organizationId,
          ...(params.groupFilter ? { groupFilter: params.groupFilter } : {}),
          ...(params.tagsFilter ? { tagsFilter: params.tagsFilter } : {}),
        }),
        first: bufferPageSize(params.limit ?? DEFAULT_LIMIT),
        after: params.after || null,
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    const connection = toRecord(data.ideas)
    const edges = toArray(connection.edges).map((value) => {
      const edge = toRecord(value)
      return { cursor: String(edge.cursor ?? ''), node: mapBufferIdea(edge.node) }
    })
    return {
      success: true,
      output: {
        ideas: edges.map((edge) => edge.node),
        edges,
        pageInfo: mapBufferPageInfo(connection.pageInfo),
      },
    }
  },

  outputs: {
    ideas: {
      type: 'array',
      description: 'Content ideas in the organization',
      items: { type: 'object', properties: IDEA_OUTPUT_PROPERTIES },
    },
    edges: {
      type: 'array',
      description: 'Edges with cursor and full idea node',
      items: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'Cursor for this node' },
          node: { type: 'object', properties: IDEA_OUTPUT_PROPERTIES },
        },
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination info for fetching the next page',
      properties: PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
