import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { mergeFileDocContract } from '@/lib/api/contracts/file-doc'
import { parseRequest } from '@/lib/api/server'
import { buildFileDocMergeUpdate } from '@/lib/collab-doc/merge'
import { checkInternalApiKey, createUnauthorizedResponse } from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('FileDocMergeAPI')

/**
 * POST /api/internal/file-doc/merge — merge new markdown into a live collaborative document as a
 * minimal Yjs diff (Stage C — copilot writing into an open doc). The realtime relay ships the current
 * doc state; the app returns the diff to apply + relay. Internal only: gated on the shared
 * `x-api-key: INTERNAL_API_SECRET` secret, matching the seed endpoint and the realtime relay.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) return createUnauthorizedResponse()

  const parsed = await parseRequest(mergeFileDocContract, request, {})
  if (!parsed.success) return parsed.response
  const { fileId, docState, markdown } = parsed.data.body

  try {
    const update = buildFileDocMergeUpdate(Buffer.from(docState, 'base64'), markdown)
    return NextResponse.json({ update: Buffer.from(update).toString('base64') })
  } catch (error) {
    logger.error('Failed to merge markdown into file-doc', { fileId, error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to merge document') },
      { status: 500 }
    )
  }
})
