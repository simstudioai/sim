import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { cleanupExpiredIdempotencyKeys, estimateIdempotencyKeyCount } from '@/lib/core/idempotency'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('IdempotencyCleanupAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for cleanup

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`Idempotency cleanup triggered (${requestId})`)

  try {
    const authError = verifyCronAuth(request, 'Idempotency key cleanup')
    if (authError) {
      return authError
    }

    const result = await cleanupExpiredIdempotencyKeys({
      maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
      batchSize: 1000,
    })

    const estimatedKeysRemaining = await estimateIdempotencyKeyCount()
    logger.info('Idempotency cleanup finished', {
      deleted: result.deleted,
      deletedByNamespace: result.deletedByNamespace,
      estimatedKeysRemaining,
    })

    return NextResponse.json({
      success: true,
      message: 'Idempotency key cleanup completed',
      requestId,
      result: {
        deleted: result.deleted,
        deletedByNamespace: result.deletedByNamespace,
        errors: result.errors,
        estimatedKeysRemaining,
      },
    })
  } catch (error) {
    logger.error(`Error during idempotency cleanup (${requestId}):`, error)
    return NextResponse.json(
      {
        success: false,
        message: 'Idempotency cleanup failed',
        error: getErrorMessage(error, 'Unknown error'),
        requestId,
      },
      { status: 500 }
    )
  }
})
