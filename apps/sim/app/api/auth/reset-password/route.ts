import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'

export const dynamic = 'force-dynamic'

const logger = createLogger('PasswordReset')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, newPassword } = body

    if (!token || !newPassword) {
      return NextResponse.json({ message: 'Token and new password are required' }, { status: 400 })
    }

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
