import { db } from '@sim/db'
import { settings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { updateUserSettingsContract } from '@/lib/api/contracts'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { defaultUserSettings, getUserSettings } from '@/lib/users/queries'

const logger = createLogger('UserSettingsAPI')

export const GET = withRouteHandler(async () => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    const data = await getUserSettings(session?.user?.id ?? null)
    return NextResponse.json({ data }, { status: 200 })
  } catch (error: any) {
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
        ...defaultUserSettings,
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
  } catch (error: any) {
    logger.error(`[${requestId}] Settings update error`, error)
    return NextResponse.json({ success: true }, { status: 200 })
  }
})
