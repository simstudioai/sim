import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logs/console-logger'
import { markWaitlistUserAsSignedUp } from '@/lib/waitlist/service'
import { verifyToken } from '@/lib/waitlist/token'

const logger = new Logger('VerifyWaitlistToken')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token } = body

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: 'Token is required',
        },
        { status: 400 }
      )
    }

    // Verify token
    const decodedToken = await verifyToken(token)

    if (!decodedToken) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid or expired token',
        },
        { status: 400 }
      )
    }

    // Check if it's a waitlist approval token
    if (decodedToken.type !== 'waitlist-approval') {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid token type',
        },
        { status: 400 }
      )
    }

    const email = decodedToken.email

    // Mark the user as signed up
    const result = await markWaitlistUserAsSignedUp(email)

    if (!result.success) {
      logger.warn(`Failed to mark user as signed up: ${result.message}`, { email })
      // Continue even if this fails - we still want to allow the user to sign up
    } else {
      logger.info(`Successfully marked waitlist user as signed up`, { email })
    }

    return NextResponse.json({
      success: true,
      email: email,
    })
  } catch (error) {
    logger.error('Error verifying waitlist token:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'An error occurred while verifying the token',
      },
      { status: 500 }
    )
  }
}
