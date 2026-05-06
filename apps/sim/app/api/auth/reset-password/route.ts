import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { resetPasswordContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { auth } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('PasswordResetAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsed = await parseRequest(
      resetPasswordContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn('Invalid password reset request data', { errors: error.issues })
          const message = error.issues.map((e) => e.message).join(' ')
          return NextResponse.json({ message }, { status: 400 })
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { token, newPassword } = parsed.data.body

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
