import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { isSameOrigin } from '@/lib/core/utils/validation'

export const dynamic = 'force-dynamic'

const logger = createLogger('ForgetPasswordAPI')

const forgetPasswordSchema = z.object({
  email: z.string().email('Please provide a valid email address'),
  redirectTo: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val === '' || val === undefined ? undefined : val))
    .refine(
      (val) => val === undefined || (z.string().url().safeParse(val).success && isSameOrigin(val)),
      {
        message: 'Redirect URL must be a valid same-origin URL',
      }
    ),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const validationResult = forgetPasswordSchema.safeParse(body)

    if (!validationResult.success) {
      const issues =
        validationResult.error.issues ??
        (validationResult.error as { errors?: z.ZodIssue[] }).errors ??
        []
      const firstError = issues[0]
      const errorMessage = firstError?.message || 'Invalid request data'
      const normalizedMessage =
        firstError?.code === 'invalid_type' && firstError.path?.[0] === 'email'
          ? 'Email is required'
          : errorMessage

      logger.warn('Invalid forget password request data', {
        errors: validationResult.error.format(),
      })
      return NextResponse.json({ message: normalizedMessage }, { status: 400 })
    }

    const { email, redirectTo } = validationResult.data

    await auth.api.forgetPassword({
      body: {
        email,
        redirectTo,
      },
      method: 'POST',
    })

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
}
