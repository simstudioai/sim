import { db } from '@sim/db'
import { user, verification } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { auth } from '@/lib/auth'

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
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
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

    // Resolve the user from the reset token before consuming it
    let actorId = 'unknown'
    let actorName: string | null = null
    let actorEmail: string | null = null
    try {
      const [verificationRecord] = await db
        .select({ value: verification.value })
        .from(verification)
        .where(eq(verification.identifier, `reset-password:${token}`))
        .limit(1)
      if (verificationRecord?.value) {
        actorId = verificationRecord.value
        const [userRecord] = await db
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, actorId))
          .limit(1)
        actorName = userRecord?.name ?? null
        actorEmail = userRecord?.email ?? null
      }
    } catch {
      logger.debug('Could not resolve user from reset token for audit')
    }

    await auth.api.resetPassword({
      body: {
        newPassword,
        token,
      },
      method: 'POST',
    })

    recordAudit({
      actorId,
      actorName,
      actorEmail,
      action: AuditAction.PASSWORD_RESET,
      resourceType: AuditResourceType.PASSWORD,
      description: 'Password reset completed',
      request,
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
