import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { validationErrorResponse } from '@/lib/api/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { runDetached } from '@/lib/core/utils/background'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { pollNoActivityEvents } from '@/lib/workspace-events/no-activity'

const logger = createLogger('WorkspaceEventsPoll')

export const maxDuration = 120

const LOCK_KEY = 'workspace-events-no-activity-poll-lock'
const LOCK_TTL_SECONDS = 120

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateShortId()
  logger.info(`Workspace events no-activity polling triggered (${requestId})`)
  const queryValidation = noInputSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  )
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)

  try {
    const authError = verifyCronAuth(request, 'Workspace events polling')
    if (authError) {
      return authError
    }

    const lockAcquired = await acquireLock(LOCK_KEY, requestId, LOCK_TTL_SECONDS)

    if (!lockAcquired) {
      return NextResponse.json(
        {
          success: true,
          message: 'Polling already in progress – skipped',
          requestId,
          status: 'skip',
        },
        { status: 202 }
      )
    }

    runDetached('workspace-events-no-activity-polling', async () => {
      try {
        await pollNoActivityEvents()
      } finally {
        await releaseLock(LOCK_KEY, requestId).catch(() => {})
      }
    })

    return NextResponse.json(
      {
        success: true,
        message: 'Workspace events polling started',
        requestId,
        status: 'started',
      },
      { status: 202 }
    )
  } catch (error) {
    logger.error(`Error during workspace events polling (${requestId}):`, error)
    return NextResponse.json(
      {
        success: false,
        message: 'Workspace events polling failed',
        error: getErrorMessage(error, 'Unknown error'),
        requestId,
      },
      { status: 500 }
    )
  }
})
