import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'

const logger = createLogger('ForgetPasswordAPI')

const forgetPasswordSchema = z.object({
  email: z.string().email('Please provide a valid email address'),
  redirectTo: z
    .string()
    .url('Redirect URL must be a valid URL')
    .optional()
    .or(z.literal(''))
    .transform((val) => (val === '' ? undefined : val)),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const validationResult = forgetPasswordSchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn('Invalid forget password request data', {
        errors: validationResult.error.format(),
      })
      return NextResponse.json(
        { message: 'Invalid request data', details: validationResult.error.format() },
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
