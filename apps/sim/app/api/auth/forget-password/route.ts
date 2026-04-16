import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { auth } from '@/lib/auth'
import { isSameOrigin } from '@/lib/core/utils/validation'

export const dynamic = 'force-dynamic'

const logger = createLogger('ForgetPasswordAPI')

const forgetPasswordSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Please provide a valid email address'),
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
      const firstError = validationResult.error.errors[0]
      const errorMessage = firstError?.message || 'Invalid request data'

      logger.warn('Invalid forget password request data', {
        errors: validationResult.error.format(),
      })
      return NextResponse.json({ message: errorMessage }, { status: 400 })
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
}
