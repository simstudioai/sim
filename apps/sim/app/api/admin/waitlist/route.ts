import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Logger } from '@/lib/logs/console-logger'
import {
  approveBatchWaitlistUsers,
  approveWaitlistUser,
  getWaitlistEntries,
  rejectWaitlistUser,
  resendApprovalEmail,
} from '@/lib/waitlist/service'

const logger = new Logger('WaitlistAPI')

// Schema for GET request query parameters
const getQuerySchema = z.object({
  page: z.coerce.number().optional().default(1),
  limit: z.coerce.number().optional().default(20),
  status: z.enum(['all', 'pending', 'approved', 'rejected', 'signed_up']).optional(),
  search: z.string().optional(),
})

// Schema for POST request body
const actionSchema = z.object({
  email: z.string().email(),
  action: z.enum(['approve', 'reject', 'resend']),
})

// Schema for batch approval request
const batchActionSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(100),
  action: z.literal('batchApprove'),
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

// Catch and handle Resend API errors
function detectResendRateLimitError(error: any): boolean {
  if (!error) return false

  // Check for structured error from Resend
  if (
    error.statusCode === 429 ||
    (error.name && error.name === 'rate_limit_exceeded') ||
    (error.message && error.message.toLowerCase().includes('rate'))
  ) {
    return true
  }

  // Check string error message
  if (
    typeof error === 'string' &&
    (error.toLowerCase().includes('rate') ||
      error.toLowerCase().includes('too many') ||
      error.toLowerCase().includes('limit'))
  ) {
    return true
  }

  // If the error is an object, check common properties
  if (typeof error === 'object') {
    const errorStr = JSON.stringify(error).toLowerCase()
    return (
      errorStr.includes('rate') ||
      errorStr.includes('too many') ||
      errorStr.includes('limit') ||
      errorStr.includes('429')
    )
  }

  return false
}

export async function GET(request: NextRequest) {
  try {
    // Check authorization
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, message: 'Unauthorized access' }, { status: 401 })
    }

    // Parse query parameters
    const { searchParams } = request.nextUrl
    const page = searchParams.get('page') ? Number(searchParams.get('page')) : 1
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : 20
    const status = searchParams.get('status') || 'all'
    const search = searchParams.get('search') || undefined

    logger.info(
      `API route: Received request with status: "${status}", search: "${search || 'none'}", page: ${page}, limit: ${limit}`
    )

    // Validate params
    const validatedParams = getQuerySchema.safeParse({ page, limit, status, search })

    if (!validatedParams.success) {
      logger.error('Invalid parameters:', validatedParams.error.format())
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid parameters',
          errors: validatedParams.error.format(),
        },
        { status: 400 }
      )
    }

    // Get waitlist entries with search parameter
    const entries = await getWaitlistEntries(
      validatedParams.data.page,
      validatedParams.data.limit,
      validatedParams.data.status,
      validatedParams.data.search
    )

    logger.info(
      `API route: Returning ${entries.entries.length} entries for status: "${status}", total: ${entries.total}`
    )

    // Return response with cache control header to prevent caching
    return new NextResponse(JSON.stringify({ success: true, data: entries }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
  } catch (error) {
    logger.error('Admin waitlist API error:', error)

    return NextResponse.json(
      {
        success: false,
        message: 'An error occurred while processing your request',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authorization
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, message: 'Unauthorized access' }, { status: 401 })
    }

    // Parse request body
    const body = await request.json()

    // Check if it's a batch action
    if (body.action === 'batchApprove' && Array.isArray(body.emails)) {
      // Validate batch request
      const validatedData = batchActionSchema.safeParse(body)

      if (!validatedData.success) {
        return NextResponse.json(
          {
            success: false,
            message: 'Invalid batch request',
            errors: validatedData.error.format(),
          },
          { status: 400 }
        )
      }

      const { emails } = validatedData.data

      logger.info(`Processing batch approval for ${emails.length} emails`)

      try {
        const result = await approveBatchWaitlistUsers(emails)

        // Check for rate limiting
        if (!result.success && result.rateLimited) {
          logger.warn('Rate limit reached for email sending')
          return NextResponse.json(
            {
              success: false,
              message: 'Rate limit exceeded for email sending. Users were NOT approved.',
              rateLimited: true,
              results: result.results,
            },
            { status: 429 }
          )
        }

        // Return the result, even if partially successful
        return NextResponse.json({
          success: result.success,
          message: result.message,
          results: result.results,
        })
      } catch (error) {
        logger.error('Error in batch approval:', error)
        return NextResponse.json(
          {
            success: false,
            message: error instanceof Error ? error.message : 'Failed to process batch approval',
          },
          { status: 500 }
        )
      }
    } else {
      // Handle individual actions
      // Validate request
      const validatedData = actionSchema.safeParse(body)

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

      const { email, action } = validatedData.data

      let result: any

      // Perform the requested action
      if (action === 'approve') {
        try {
          // Need to handle email errors specially to prevent approving users when email fails
          result = await approveWaitlistUser(email)

          // First check for email delivery errors from Resend
          if (!result.success && result?.emailError) {
            logger.error('Email delivery error:', result.emailError)

            // Check if it's a rate limit error
            if (result.rateLimited || detectResendRateLimitError(result.emailError)) {
              return NextResponse.json(
                {
                  success: false,
                  message: 'Rate limit exceeded for email sending. User was NOT approved.',
                  rateLimited: true,
                  emailError: true,
                },
                { status: 429 }
              )
            }

            return NextResponse.json(
              {
                success: false,
                message: `Email delivery failed: ${result.message || 'Unknown email error'}. User was NOT approved.`,
                emailError: true,
              },
              { status: 500 }
            )
          }

          // Check for rate limiting
          if (!result.success && result?.rateLimited) {
            logger.warn('Rate limit reached for email sending')
            return NextResponse.json(
              {
                success: false,
                message: 'Rate limit exceeded for email sending. User was NOT approved.',
                rateLimited: true,
              },
              { status: 429 }
            )
          }

          // General failure
          if (!result.success) {
            return NextResponse.json(
              {
                success: false,
                message: result.message || 'Failed to approve user',
              },
              { status: 400 }
            )
          }
        } catch (error) {
          logger.error('Error approving waitlist user:', error)

          // Check if it's the JWT_SECRET missing error
          if (error instanceof Error && error.message.includes('JWT_SECRET')) {
            return NextResponse.json(
              {
                success: false,
                message:
                  'Configuration error: JWT_SECRET environment variable is missing. Please contact the administrator.',
              },
              { status: 500 }
            )
          }

          // Handle Resend API errors specifically
          if (
            error instanceof Error &&
            (error.message.includes('email') || error.message.includes('resend'))
          ) {
            // Handle rate limiting specifically
            if (detectResendRateLimitError(error)) {
              return NextResponse.json(
                {
                  success: false,
                  message: 'Rate limit exceeded for email sending. User was NOT approved.',
                  rateLimited: true,
                  emailError: true,
                },
                { status: 429 }
              )
            }

            return NextResponse.json(
              {
                success: false,
                message: `Email delivery failed: ${error.message}. User was NOT approved.`,
                emailError: true,
              },
              { status: 500 }
            )
          }

          return NextResponse.json(
            {
              success: false,
              message: error instanceof Error ? error.message : 'Failed to approve user',
            },
            { status: 500 }
          )
        }
      } else if (action === 'reject') {
        try {
          result = await rejectWaitlistUser(email)
        } catch (error) {
          logger.error('Error rejecting waitlist user:', error)
          return NextResponse.json(
            {
              success: false,
              message: error instanceof Error ? error.message : 'Failed to reject user',
            },
            { status: 500 }
          )
        }
      } else if (action === 'resend') {
        try {
          result = await resendApprovalEmail(email)

          // First check for email delivery errors from Resend
          if (!result.success && result?.emailError) {
            logger.error('Email delivery error:', result.emailError)

            // Check if it's a rate limit error
            if (result.rateLimited || detectResendRateLimitError(result.emailError)) {
              return NextResponse.json(
                {
                  success: false,
                  message: 'Rate limit exceeded for email sending.',
                  rateLimited: true,
                  emailError: true,
                },
                { status: 429 }
              )
            }

            return NextResponse.json(
              {
                success: false,
                message: `Email delivery failed: ${result.message || 'Unknown email error'}`,
                emailError: true,
              },
              { status: 500 }
            )
          }

          // Check for rate limiting
          if (!result.success && result?.rateLimited) {
            logger.warn('Rate limit reached for email sending')
            return NextResponse.json(
              {
                success: false,
                message: 'Rate limit exceeded for email sending',
                rateLimited: true,
              },
              { status: 429 }
            )
          }

          // General failure
          if (!result.success) {
            return NextResponse.json(
              {
                success: false,
                message: result.message || 'Failed to resend approval email',
              },
              { status: 400 }
            )
          }
        } catch (error) {
          logger.error('Error resending approval email:', error)

          // Check if it's the JWT_SECRET missing error
          if (error instanceof Error && error.message.includes('JWT_SECRET')) {
            return NextResponse.json(
              {
                success: false,
                message:
                  'Configuration error: JWT_SECRET environment variable is missing. Please contact the administrator.',
              },
              { status: 500 }
            )
          }

          // Handle Resend API errors specifically
          if (
            error instanceof Error &&
            (error.message.includes('email') || error.message.includes('resend'))
          ) {
            // Handle rate limiting specifically
            if (detectResendRateLimitError(error)) {
              return NextResponse.json(
                {
                  success: false,
                  message: 'Rate limit exceeded for email sending',
                  rateLimited: true,
                  emailError: true,
                },
                { status: 429 }
              )
            }

            return NextResponse.json(
              {
                success: false,
                message: `Email delivery failed: ${error.message}`,
                emailError: true,
              },
              { status: 500 }
            )
          }

          return NextResponse.json(
            {
              success: false,
              message: error instanceof Error ? error.message : 'Failed to resend approval email',
            },
            { status: 500 }
          )
        }
      }

      if (!result || !result.success) {
        return NextResponse.json(
          {
            success: false,
            message: result?.message || 'Failed to perform action',
          },
          { status: 400 }
        )
      }

      return NextResponse.json({
        success: true,
        message: result.message,
      })
    }
  } catch (error) {
    logger.error('Admin waitlist API error:', error)

    return NextResponse.json(
      {
        success: false,
        message: 'An error occurred while processing your request',
      },
      { status: 500 }
    )
  }
}
