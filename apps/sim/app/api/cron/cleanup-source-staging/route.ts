import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sweepExpiredStagedBlobs } from '@/lib/workspace-source/staging/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const logger = createLogger('CleanupSourceStagingAPI')

/**
 * GET /api/cron/cleanup-source-staging — deletes workspace source blobs staged for an apply that
 * never came (expired a day after last use): the rows, then their stored objects, in bounded
 * batches.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'workspace source staging cleanup')
  if (authError) return authError

  try {
    const removed = await sweepExpiredStagedBlobs()
    return NextResponse.json({ success: true, removed })
  } catch (error) {
    logger.error('Failed to sweep expired staged workspace source blobs', { error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to sweep expired staged blobs') },
      { status: 500 }
    )
  }
})
