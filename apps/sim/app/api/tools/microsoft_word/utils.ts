import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { GraphRequestError } from '@/lib/microsoft-word/graph.server'
import { MicrosoftWordInputError } from '@/tools/microsoft_word/errors'

/**
 * Projects an error raised while talking to Microsoft Graph — or while building
 * the document package — onto the `{ success, error }` envelope the Word tools
 * expect, preserving Graph's own status so a 404 or 403 is not reported as a
 * Sim-side failure.
 */
export function microsoftWordErrorResponse(
  error: unknown,
  requestId: string,
  logger: Logger,
  operation: string
): NextResponse {
  const message = getErrorMessage(error, 'Unknown error occurred')
  logger.error(`[${requestId}] Microsoft Word ${operation} failed`, { error: message })

  const status =
    error instanceof GraphRequestError || error instanceof MicrosoftWordInputError
      ? error.status
      : isPayloadSizeLimitError(error)
        ? 413
        : 500

  return NextResponse.json({ success: false, error: message }, { status })
}
