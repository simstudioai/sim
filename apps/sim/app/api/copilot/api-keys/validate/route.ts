import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotApiKeysValidate')

const ValidateApiKeySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
})

export const POST = withRouteHandler(async (req: NextRequest) => {
  try {
    const auth = checkInternalApiKey(req)
    if (!auth.success) {
      return new NextResponse(null, { status: 401 })
    }

    const body = await req.json().catch(() => null)

    const validationResult = ValidateApiKeySchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn('Invalid validation request', { errors: validationResult.error.errors })
      return NextResponse.json(
        {
          error: 'userId is required',
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { userId } = validationResult.data

    const [existingUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
    if (!existingUser) {
      logger.warn('[API VALIDATION] userId does not exist', { userId })
      return NextResponse.json({ error: 'User not found' }, { status: 403 })
    }

    logger.info('[API VALIDATION] Validating usage limit', { userId })

    const { isExceeded, currentUsage, limit } = await checkServerSideUsageLimits(userId)

    logger.info('[API VALIDATION] Usage limit validated', {
      userId,
      currentUsage,
      limit,
      isExceeded,
    })

    if (isExceeded) {
      logger.info('[API VALIDATION] Usage exceeded', { userId, currentUsage, limit })
      return new NextResponse(null, { status: 402 })
    }

    return new NextResponse(null, { status: 200 })
  } catch (error) {
    logger.error('Error validating usage limit', { error })
    return NextResponse.json({ error: 'Failed to validate usage' }, { status: 500 })
  }
})
