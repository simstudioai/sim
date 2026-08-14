import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { resetPasswordContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { auth } from '@/lib/auth'
import { enforceIpRateLimit, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('PasswordResetAPI')

/**
 * Submitting reset tokens without a session is guessing; a legitimate user
 * submits once. Tighter than the public default for that reason.
 */
const RESET_PASSWORD_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 10,
  refillIntervalMs: 15 * 60_000,
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimited = await enforceIpRateLimit(
      'reset-password',
      request,
      RESET_PASSWORD_RATE_LIMIT
    )
    if (rateLimited) return rateLimited

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
