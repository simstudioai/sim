import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ForgetPasswordAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, redirectTo } = body

    if (!email) {
      return NextResponse.json({ message: 'Email is required' }, { status: 400 })
    }

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
