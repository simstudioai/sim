import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Logger } from '@/lib/logs/console-logger'
import { approveWaitlistUser, rejectWaitlistUser, resendApprovalEmail } from '@/lib/waitlist/service'

const logger = new Logger('WaitlistBulkAPI')

// Schema for POST request body
const bulkActionSchema = z.object({
  emails: z.array(z.string().email()),
  action: z.enum(['approve', 'reject', 'resend']),
})

// Admin password from environment variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

// Check if the request has valid admin password
function isAuthorized(request: NextRequest) {
  // Get authorization header (Bearer token)
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false
  }

  // Extract token
  const token = authHeader.split(' ')[1]

  // Compare with expected token
  return token === ADMIN_PASSWORD
}

export async function POST(request: NextRequest) {
  try {
    // Check authorization
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, message: 'Unauthorized access' }, { status: 401 })
    }

    // Parse request body
    const body = await request.json()

    // Validate request
    const validatedData = bulkActionSchema.safeParse(body)

    if (!validatedData.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid request',
          errors: validatedData.error.format(),
        },
        { status: 400 }
      )
    }

    const { emails, action } = validatedData.data

    if (emails.length === 0) {
      return NextResponse.json({ success: false, message: 'No emails provided' }, { status: 400 })
    }

    // Process each email
    let results
    try {
      results = await Promise.allSettled(
        emails.map((email) => {
          if (action === 'approve') {
            return approveWaitlistUser(email)
          } else if (action === 'reject') {
            return rejectWaitlistUser(email)
          } else if (action === 'resend') {
            return resendApprovalEmail(email)
          }
          throw new Error('Invalid action')
        })
      )

      // Check if there's a JWT_SECRET error
      const jwtError = results.find(
        (r) =>
          r.status === 'rejected' &&
          r.reason instanceof Error &&
          r.reason.message.includes('JWT_SECRET')
      )

      if (jwtError) {
        return NextResponse.json(
          {
            success: false,
            message:
              'Configuration error: JWT_SECRET environment variable is missing. Please contact the administrator.',
          },
          { status: 500 }
        )
      }

      // Count successful and failed operations
      const successful = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as any).success
      ).length
      const failed = emails.length - successful

      return NextResponse.json({
        success: true,
        message: `Processed ${emails.length} entries: ${successful} successful, ${failed} failed`,
        details: {
          successful,
          failed,
          total: emails.length,
        },
      })
    } catch (error) {
      logger.error('Error in bulk processing:', error)

      return NextResponse.json(
        {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : 'An error occurred while processing your request',
        },
        { status: 500 }
      )
    }
  } catch (error) {
    logger.error('Admin waitlist bulk API error:', error)

    return NextResponse.json(
      {
        success: false,
        message: 'An error occurred while processing your request',
      },
      { status: 500 }
    )
  }
}
