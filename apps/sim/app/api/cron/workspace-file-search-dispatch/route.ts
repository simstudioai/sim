import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enqueueWorkspaceFileSearchDispatch } from '@/lib/workspace-files/search/enqueue-dispatch'

const logger = createLogger('WorkspaceFileSearchDispatchRoute')

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Workspace file search dispatcher')
  if (authError) return authError

  try {
    const result = await enqueueWorkspaceFileSearchDispatch()
    logger.info('Workspace file search dispatcher accepted', result)
    return NextResponse.json({ success: true, triggered: true, ...result }, { status: 202 })
  } catch (error) {
    logger.error('Workspace file search dispatcher enqueue failed', {
      error: toError(error).message,
    })
    return NextResponse.json(
      { success: false, error: 'Dispatcher enqueue failed' },
      { status: 500 }
    )
  }
})
