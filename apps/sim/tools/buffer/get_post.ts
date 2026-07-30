import {
  BUFFER_API_URL,
  BUFFER_POST_SELECTION,
  type BufferGetPostParams,
  type BufferPostResponse,
  bufferHeaders,
  mapBufferPost,
  POST_OUTPUT_PROPERTIES,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const GET_POST_QUERY = `
  query GetPost($input: PostInput!) {
    post(input: $input) {
      ${BUFFER_POST_SELECTION}
    }
  }
`

export const bufferGetPostTool: ToolConfig<BufferGetPostParams, BufferPostResponse> = {
  id: 'buffer_get_post',
  name: 'Buffer Get Post',
  description: 'Get a single Buffer post by ID, including its status, schedule, and media',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key',
    },
    postId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the post to fetch',
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: GET_POST_QUERY,
      variables: {
        input: { id: params.postId },
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    if (!data.post) {
      throw new Error('Post not found')
    }
    return {
      success: true,
      output: {
        post: mapBufferPost(data.post),
      },
    }
  },

  outputs: {
    post: {
      type: 'object',
      description: 'The requested post',
      properties: POST_OUTPUT_PROPERTIES,
    },
  },
}
