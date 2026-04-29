import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { forgetPasswordBodySchema } from '@/lib/api/contracts'
import { getValidationErrorMessage } from '@/lib/api/server'
import { auth } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('ForgetPasswordAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const body = await request.json()

    const validationResult = forgetPasswordBodySchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn('Invalid forget password request data', {
        errors: validationResult.error.issues,
      })
      return NextResponse.json(
        {
          message: getValidationErrorMessage(validationResult.error, 'Invalid request data'),
        },
        { status: 400 }
      )
    }

    const { email, redirectTo } = validationResult.data

    await auth.api.forgetPassword({
      body: {
        email,
        redirectTo,
      },
      method: 'POST',
    })

    const [existingUser] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.email, email))
      .limit(1)

    if (existingUser) {
      recordAudit({
        actorId: existingUser.id,
        actorName: existingUser.name,
        actorEmail: existingUser.email,
        action: AuditAction.PASSWORD_RESET_REQUESTED,
        resourceType: AuditResourceType.PASSWORD,
        resourceId: existingUser.id,
        resourceName: existingUser.email ?? undefined,
        description: `Password reset requested for ${existingUser.email}`,
        request,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error requesting password reset:', { error })

    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : 'Failed to send password reset email. Please try again later.',
      },
      { status: 500 }
    )
  }
})
