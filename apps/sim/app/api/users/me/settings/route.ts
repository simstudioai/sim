import { db } from '@sim/db'
import { settings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { updateUserSettingsContract } from '@/lib/api/contracts'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { InternalUnauthenticatedError, internalSessionAuth } from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCurrentUserSettingsUseCase } from '@/lib/users/application/read-current-user'
import { defaultUserSettings } from '@/lib/users/queries'

const logger = createLogger('UserSettingsAPI')

export const GET = withRouteHandler(async () => {
  try {
    const principal = await internalSessionAuth.authenticate()
    const data = await getCurrentUserSettingsUseCase.execute({ principal, input: {} })
    return NextResponse.json({ data }, { status: 200 })
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError) {
      return NextResponse.json({ data: { ...defaultUserSettings, telemetryEnabled: false } })
    }
    logger.error('Settings fetch error', error)
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
})

export const PATCH = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const parsed = await parseRequest(
      updateUserSettingsContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn('Invalid settings data', { errors: error.issues })
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

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Settings update error', error)
    /** Failed writes must trigger the client's optimistic rollback, including privacy choices. */
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
})
