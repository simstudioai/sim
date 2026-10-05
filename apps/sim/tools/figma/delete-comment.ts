import { z } from 'zod'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import type { FigmaDeleteCommentParams, FigmaResponse } from '@/tools/figma/types'
import { figmaApiUrl, figmaFilePath, figmaHeaders } from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const figmaDeleteCommentTool: ToolConfig<
  FigmaDeleteCommentParams,
  FigmaResponse<{ deleted: boolean }>
> = {
  id: 'figma_delete_comment',
  name: 'Figma Delete Comment',
  description: 'Delete a Figma comment authored by the connected account',
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
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the comment to delete',
    },
  },
  request: {
    url: (params) =>
      figmaApiUrl(
        `${figmaFilePath(params)}/comments/${safeUrlPathSegment(params.commentId, 'commentId')}`
      ),
    method: 'DELETE',
    headers: figmaHeaders,
  },
  transformResponse: async (response, _params, context) => {
    if (!response.ok) throw new Error(`Figma deletion failed (${response.status})`)
    const text = await readResponseTextWithLimit(response, {
      maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
      label: 'Figma deletion response',
      signal: context?.signal,
    })
    if (text.trim())
      z.object({ status: z.literal(200), error: z.literal(false) }).parse(JSON.parse(text))
    return { success: true, output: { deleted: true } }
  },
  outputs: { deleted: { type: 'boolean', description: 'Whether the comment was deleted' } },
}
