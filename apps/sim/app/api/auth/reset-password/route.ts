import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'

const logger = createLogger('PasswordResetAPI')

const resetPasswordSchema = z.object({
  token: z.string({ required_error: 'Token is required' }).min(1, 'Token is required'),
  newPassword: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters long')
    .max(100, 'Password must not exceed 100 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const validationResult = resetPasswordSchema.safeParse(body)

    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0]
      const errorMessage = firstError?.message || 'Invalid request data'

      logger.warn('Invalid password reset request data', {
        errors: validationResult.error.format(),
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
}
