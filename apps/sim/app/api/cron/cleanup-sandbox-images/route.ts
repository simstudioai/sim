import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runCleanupSandboxImages } from '@/background/cleanup-sandbox-images'

export const dynamic = 'force-dynamic'

const logger = createLogger('CleanupSandboxImagesAPI')

/**
 * Retention sweep for prebuilt sandbox images. A runtime-strategy deployment has
 * nothing to collect, so the sweep is a no-op there rather than a special case
 * here.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'sandbox image cleanup')
  if (authError) return authError

  try {
    const result = await runCleanupSandboxImages()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error('Failed to sweep sandbox images', { error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to sweep sandbox images') },
      { status: 500 }
    )
  }
})
