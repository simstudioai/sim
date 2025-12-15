import type { FigmaListCommentsParams, FigmaListCommentsResponse } from '@/tools/figma/types'
import type { ToolConfig } from '@/tools/types'

export const figmaListCommentsTool: ToolConfig<FigmaListCommentsParams, FigmaListCommentsResponse> =
  {
    id: 'figma_list_comments',
    name: 'Figma - List Comments',
    description: 'Get all comments on a Figma file',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'figma',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token',
      },
      fileKey: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The key of the Figma file (from the URL: figma.com/file/{fileKey}/...)',
      },
    },

    request: {
      url: (params) => `https://api.figma.com/v1/files/${params.fileKey}/comments`,
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()
      const comments = data.comments || []

      return {
        success: true,
        output: {
          comments,
          metadata: {
            commentCount: comments.length,
          },
        },
      }
    },

    outputs: {
      comments: {
        type: 'json',
        description: 'Array of comments on the file',
      },
      metadata: {
        type: 'json',
        description: 'Metadata including comment count',
      },
    },
  }
