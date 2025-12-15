import type { FigmaAddCommentParams, FigmaAddCommentResponse } from '@/tools/figma/types'
import type { ToolConfig } from '@/tools/types'

export const figmaAddCommentTool: ToolConfig<FigmaAddCommentParams, FigmaAddCommentResponse> = {
  id: 'figma_add_comment',
  name: 'Figma - Add Comment',
  description: 'Add a comment to a Figma file, optionally on a specific node',
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
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The comment message text',
    },
    nodeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional node ID to attach the comment to a specific element',
    },
  },

  request: {
    url: (params) => `https://api.figma.com/v1/files/${params.fileKey}/comments`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        message: params.message,
      }

      if (params.nodeId) {
        body.client_meta = {
          node_id: params.nodeId,
        }
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        comment: data,
      },
    }
  },

  outputs: {
    comment: {
      type: 'json',
      description: 'The created comment object',
    },
  },
}
