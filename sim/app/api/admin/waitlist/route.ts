import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  approveWaitlistUser,
  getWaitlistEntries,
  rejectWaitlistUser,
  WaitlistStatus,
} from '@/lib/waitlist/service'
import { db } from '@/db'
import { session, user } from '@/db/schema'

// Schema for GET request query parameters
const getQuerySchema = z.object({
  page: z.coerce.number().optional().default(1),
  limit: z.coerce.number().optional().default(20),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
})

// Schema for POST request body
const actionSchema = z.object({
  email: z.string().email(),
  action: z.enum(['approve', 'reject']),
})

// Check if the user has admin permissions
async function isAdmin(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)

  if (!sessionCookie) {
    return false
  }

  try {
    // Get the user ID from the session cookie
    const sessionId = sessionCookie

    // Fetch the session to get the user ID
    const sessionRecord = await db
      .select()
      .from(session)
      .where(eq(session.id, sessionId))
      .limit(1)
      .then((rows) => rows[0])

    if (!sessionRecord) {
      return false
    }

    // Fetch the user
    const userRecord = await db
      .select()
      .from(user)
      .where(eq(user.id, sessionRecord.userId))
      .limit(1)
      .then((rows) => rows[0])

    if (!userRecord) {
      return false
    }

    // Check if the user's email is in the admin list
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim())
    return adminEmails.includes(userRecord.email)
  } catch (error) {
    console.error('Error checking admin status:', error)
    return false
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify user is an admin
    const admin = await isAdmin(request)

    if (!admin) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    // Parse query parameters
    const { searchParams } = request.nextUrl
    const page = searchParams.get('page') ? Number(searchParams.get('page')) : 1
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : 20
    const status = searchParams.get('status') as WaitlistStatus | null

    // Validate params
    const validatedParams = getQuerySchema.safeParse({ page, limit, status })

    if (!validatedParams.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid parameters',
          errors: validatedParams.error.format(),
        },
        { status: 400 }
      )
    }

    // Get waitlist entries
    const entries = await getWaitlistEntries(
      validatedParams.data.page,
      validatedParams.data.limit,
      validatedParams.data.status
    )

    return NextResponse.json({ success: true, data: entries })
  } catch (error) {
    console.error('Admin waitlist API error:', error)

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
    // Verify user is an admin
    const admin = await isAdmin(request)

    if (!admin) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
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
      result = await approveWaitlistUser(email)
    } else if (action === 'reject') {
      result = await rejectWaitlistUser(email)
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
    console.error('Admin waitlist API error:', error)

    return NextResponse.json(
      {
        success: false,
        message: 'An error occurred while processing your request',
      },
      { status: 500 }
    )
  }
}
