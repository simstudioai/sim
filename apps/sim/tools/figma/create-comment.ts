import { z } from 'zod'
import type { FigmaComment, FigmaCreateCommentParams, FigmaResponse } from '@/tools/figma/types'
import { FIGMA_COMMENT_OUTPUT_PROPERTIES } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaCommentPositionSchema,
  figmaCommentSchema,
  figmaFilePath,
  figmaHeaders,
  figmaJson,
  figmaOptionalString,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaCreateCommentTool: ToolConfig<
  FigmaCreateCommentParams,
  FigmaResponse<{ comment: FigmaComment }>
> = {
  id: 'figma_create_comment',
  name: 'Figma Create Comment',
  description: 'Post a comment on a Figma file or reply to a root comment',
  version: '1.0.0',
  oauth: { required: true, provider: 'figma' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Figma OAuth access token',
    },
    fileKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Figma file key or HTTPS Figma file URL',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text of the comment',
    },
    replyToCommentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Root comment ID to reply to; replies cannot be parents',
    },
    clientMeta: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Canvas or frame-relative comment position',
    },
  },
  request: {
    url: (params) => figmaApiUrl(`${figmaFilePath(params)}/comments`),
    method: 'POST',
    headers: figmaHeaders,
    body: (params) => ({
      message: z.string().min(1, 'message is required').parse(params.message),
      comment_id: figmaOptionalString(params.replyToCommentId, 'replyToCommentId'),
      client_meta:
        params.clientMeta === undefined || params.clientMeta === ''
          ? undefined
          : figmaCommentPositionSchema.parse(
              typeof params.clientMeta === 'string'
                ? JSON.parse(params.clientMeta)
                : params.clientMeta
            ),
    }),
  },
  transformResponse: async (response, _params, context) => {
    return {
      success: true,
      output: { comment: figmaCommentSchema.parse(await figmaJson(response, context)) },
    }
  },
  outputs: {
    comment: {
      type: 'object',
      description: 'Created comment or reply',
      properties: FIGMA_COMMENT_OUTPUT_PROPERTIES,
    },
  },
}
