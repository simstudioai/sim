import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  executeInstagramDownloadMedia,
  executeInstagramPublishCarousel,
  executeInstagramPublishImage,
  executeInstagramPublishReel,
  executeInstagramPublishStory,
  executeInstagramPublishVideo,
  type InstagramOperationContext,
} from '@/lib/internal/instagram/operations'
import {
  instagramDownloadMediaBodySchema,
  instagramPublishCarouselBodySchema,
  instagramPublishImageBodySchema,
  instagramPublishReelBodySchema,
  instagramPublishStoryBodySchema,
  instagramPublishVideoBodySchema,
} from '@/lib/internal/instagram/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('InstagramToolExecution')

async function executeParsed<S extends z.ZodType>(
  request: InternalToolOperationCall,
  schema: S,
  execute: (input: z.output<S>, context: InstagramOperationContext) => Promise<Response>
): Promise<Response> {
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    const error = getValidationErrorMessage(parsed.error, 'Invalid request data')
    return request.toolId === 'instagram_download_media'
      ? Response.json({ success: false, error }, { status: 400 })
      : Response.json({ error, details: parsed.error.issues }, { status: 400 })
  }

  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  return execute(parsed.data, {
    userId,
    workspaceId: request.context.workspaceId,
    workflowId: request.context.workflowId,
    executionId: request.context.executionId,
    requestId: request.requestId,
    signal: request.signal,
  })
}

export const executeInstagramTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  try {
    switch (request.toolId) {
      case 'instagram_download_media':
        return executeParsed(
          request,
          instagramDownloadMediaBodySchema,
          executeInstagramDownloadMedia
        )
      case 'instagram_publish_carousel':
        return executeParsed(
          request,
          instagramPublishCarouselBodySchema,
          executeInstagramPublishCarousel
        )
      case 'instagram_publish_image':
        return executeParsed(request, instagramPublishImageBodySchema, executeInstagramPublishImage)
      case 'instagram_publish_reel':
        return executeParsed(request, instagramPublishReelBodySchema, executeInstagramPublishReel)
      case 'instagram_publish_story':
        return executeParsed(request, instagramPublishStoryBodySchema, executeInstagramPublishStory)
      case 'instagram_publish_video':
        return executeParsed(request, instagramPublishVideoBodySchema, executeInstagramPublishVideo)
      default:
        return Response.json(
          { success: false, error: `Unsupported Instagram tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Instagram operation dispatch failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
