import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getUserProfileContract, updateUserProfileContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { userAccountOperations } from '@/lib/users/application/operations'
import { getCurrentUserProfileUseCase } from '@/lib/users/application/read-current-user'

const logger = createLogger('UpdateUserProfileAPI')

interface UpdateData {
  updatedAt: Date
  name?: string
  image?: string | null
}

export const dynamic = 'force-dynamic'

export const PATCH = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized profile update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const parsed = await parseRequest(updateUserProfileContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const updateData: UpdateData = { updatedAt: new Date() }
    if (validatedData.name !== undefined) updateData.name = validatedData.name
    if (validatedData.image !== undefined) updateData.image = validatedData.image

    const [updatedUser] = await db
      .update(user)
      .set(updateData)
      .where(eq(user.id, userId))
      .returning()

    if (!updatedUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] User profile updated`, {
      userId,
      updatedFields: Object.keys(validatedData),
    })

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        image: updatedUser.image,
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Profile update error`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const GET = defineInternalJsonRoute({
  contract: getUserProfileContract,
  auth: internalSessionAuth,
  operation: userAccountOperations.readProfile,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated current-user profile read',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: () => ({}),
  useCase: getCurrentUserProfileUseCase,
  present: (userRecord) => ({ user: userRecord }),
})
