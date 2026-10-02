import { z } from 'zod'
import type { FigmaComment, FigmaListCommentsParams, FigmaResponse } from '@/tools/figma/types'
import { FIGMA_COMMENT_OUTPUT_PROPERTIES } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaCommentSchema,
  figmaFilePath,
  figmaHeaders,
  figmaJson,
  figmaOptionalBoolean,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaListCommentsTool: ToolConfig<
  FigmaListCommentsParams,
  FigmaResponse<{ comments: FigmaComment[] }>
> = {
  id: 'figma_list_comments',
  name: 'Figma List Comments',
  description: 'List comments and replies on a Figma file',
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
    asMarkdown: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return comments in Markdown when available',
    },
  },
  request: {
    url: (params) =>
      figmaApiUrl(`${figmaFilePath(params)}/comments`, {
        as_md: figmaOptionalBoolean(params.asMarkdown, 'asMarkdown'),
      }),
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    const data = z
      .object({ comments: z.array(figmaCommentSchema) })
      .parse(await figmaJson(response, context))
    return { success: true, output: { comments: data.comments } }
  },
  outputs: {
    comments: {
      type: 'array',
      description: 'Comments and replies',
      items: { type: 'object', properties: FIGMA_COMMENT_OUTPUT_PROPERTIES },
    },
  },
}
