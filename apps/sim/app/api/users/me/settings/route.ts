import { db } from '@sim/db'
import { settings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { updateUserSettingsContract } from '@/lib/api/contracts'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { invalidateSuperUserGate } from '@/lib/mothership/server/agent-url'
import { getCurrentUserSettingsUseCase } from '@/lib/users/application/read-current-user'
import { defaultUserSettings } from '@/lib/users/queries'

const logger = createLogger('UserSettingsAPI')

export const GET = withRouteHandler(async () => {
  const requestId = generateRequestId()

  try {
    const principal = await internalSessionAuth.authenticate()
    const data = await getCurrentUserSettingsUseCase.execute({ principal, input: {} })
    return NextResponse.json({ data }, { status: 200 })
  } catch (error: any) {
    if (error instanceof InternalUnauthenticatedError) {
      return NextResponse.json({ data: defaultUserSettings }, { status: 200 })
    }
    logger.error(`[${requestId}] Settings fetch error`, error)
    return NextResponse.json({ data: defaultUserSettings }, { status: 200 })
  }
})

export const PATCH = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.info(
        `[${requestId}] Settings update attempted by unauthenticated user - acknowledged without saving`
      )
      return NextResponse.json({ success: true }, { status: 200 })
    }

    const userId = session.user.id

    const parsed = await parseRequest(
      updateUserSettingsContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid settings data`, { errors: error.issues })
          return validationErrorResponse(error, 'Invalid settings data')
        },
      }
    )
    if (!parsed.success) return parsed.response

    const validatedData = parsed.data.body

    await db
      .insert(settings)
      .values({
        id: generateShortId(),
        userId,
        ...validatedData,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [settings.userId],
        set: {
          ...validatedData,
          updatedAt: new Date(),
        },
      })

    /* Chat-turn routing caches the superuser gate; a toggle here must reach the very
       next turn, so drop this user's cached entry (same-process write → reader). */
    if ('superUserModeEnabled' in validatedData) invalidateSuperUserGate(userId)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Settings update error`, error)
    /* The client mutation is optimistic: it writes the new value into the cache in
       `onMutate` and restores it in `onError`. Answering 200 here left that rollback
       unreachable, so a failed write showed as applied until the next refetch —
       including for consent-shaped settings the user believes they changed. */
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
})
