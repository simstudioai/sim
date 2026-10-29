import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { reapPausedSessionSandboxes } from '@/lib/execution/remote-sandbox/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const logger = createLogger('CleanupSessionSandboxesAPI')

/**
 * Retention sweep for paused chat workbenches. An idle workbench pauses instead of dying and the
 * provider keeps it indefinitely, so this run is what bounds how long its files outlive the chat's
 * last use. A no-op on providers without session sandboxes.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'session sandbox cleanup')
  if (authError) return authError

  try {
    const result = await reapPausedSessionSandboxes()
    logger.info('Swept paused session sandboxes', result)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error('Failed to sweep paused session sandboxes', { error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to sweep paused session sandboxes') },
      { status: 500 }
    )
  }
})
