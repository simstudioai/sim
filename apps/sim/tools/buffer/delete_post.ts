import {
  BUFFER_API_URL,
  type BufferDeletePostParams,
  type BufferDeletePostResponse,
  bufferHeaders,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

const DELETE_POST_MUTATION = `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      __typename
      ... on DeletePostSuccess {
        id
      }
      ... on VoidMutationError {
        message
      }
    }
  }
`

export const bufferDeletePostTool: ToolConfig<BufferDeletePostParams, BufferDeletePostResponse> = {
  id: 'buffer_delete_post',
  name: 'Buffer Delete Post',
  description: 'Delete a Buffer post by ID',
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
      description: 'ID of the post to delete',
    },
  },

  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => ({
      query: DELETE_POST_MUTATION,
      variables: {
        input: { id: params.postId },
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseBufferGraphQLResponse(response)
    const result = data.deletePost
    if (result?.__typename !== 'DeletePostSuccess') {
      throw new Error(result?.message || 'Failed to delete post')
    }
    return {
      success: true,
      output: {
        deleted: true,
        id: result.id,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the post was deleted' },
    id: { type: 'string', description: 'ID of the deleted post' },
  },
}
