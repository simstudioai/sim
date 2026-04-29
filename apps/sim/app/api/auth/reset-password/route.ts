import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { resetPasswordBodySchema } from '@/lib/api/contracts'
import { auth } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('PasswordResetAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const body = await request.json()

    const validationResult = resetPasswordBodySchema.safeParse(body)

    if (!validationResult.success) {
      const errorMessage = validationResult.error.issues.map((e) => e.message).join(' ')

      logger.warn('Invalid password reset request data', {
        errors: validationResult.error.issues,
      })
      return NextResponse.json({ message: errorMessage }, { status: 400 })
    }

    const { token, newPassword } = validationResult.data

    await auth.api.resetPassword({
      body: {
        newPassword,
        token,
      },
      method: 'POST',
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error during password reset:', { error })

    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : 'Failed to reset password. Please try again or request a new reset link.',
      },
      { status: 500 }
    )
  }
})
