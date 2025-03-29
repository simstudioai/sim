import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Logger } from '@/lib/logs/console-logger'
import { approveWaitlistUser, getWaitlistEntries, rejectWaitlistUser } from '@/lib/waitlist/service'

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
  action: z.enum(['approve', 'reject']),
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

    let result

    // Perform the requested action
    if (action === 'approve') {
      try {
        result = await approveWaitlistUser(email)
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
