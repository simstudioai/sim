import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { ZoomInfoOperationError } from '@/lib/internal/zoominfo/client'
import { executeZoomInfoOperation } from '@/lib/internal/zoominfo/operations'
import { zoomInfoToolInputSchema } from '@/lib/internal/zoominfo/schema'

const logger = createLogger('ZoomInfoToolExecution')

const TOOL_IDS = new Set([
  'zoominfo_enrich_companies',
  'zoominfo_enrich_contacts',
  'zoominfo_search_companies',
  'zoominfo_search_contacts',
  'zoominfo_search_intent',
  'zoominfo_search_news',
])

function exceedsInputCap(input: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(input) ?? '') > DEFAULT_MAX_JSON_BODY_BYTES
  } catch {
    return true
  }
}

export const executeZoomInfoTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!TOOL_IDS.has(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported ZoomInfo tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  if (exceedsInputCap(request.input)) {
    return Response.json(
      {
        success: false,
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }
  const parsed = zoomInfoToolInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Validation failed') },
      { status: 400 }
    )
  }
  try {
    const output = await executeZoomInfoOperation(
      request.toolId,
      parsed.data,
      request.requestId,
      request.signal
    )
    request.signal?.throwIfAborted()
    return Response.json({ success: true, output })
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof ZoomInfoOperationError) {
      return Response.json(
        {
          success: false,
          error: error.message,
          ...(error.providerStatus === undefined ? {} : { status: error.providerStatus }),
        },
        { status: error.status }
      )
    }
    const message = getErrorMessage(error, 'Unknown error occurred')
    logger.error('ZoomInfo operation failed', { error: message, requestId: request.requestId })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
