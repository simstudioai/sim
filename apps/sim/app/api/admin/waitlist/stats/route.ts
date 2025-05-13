import { NextRequest, NextResponse } from 'next/server'
import { count } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { waitlist } from '@/db/schema'

const logger = createLogger('WaitlistStats')

export async function GET(request: NextRequest) {
  try {
    // Validate the admin token (basic for now)
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    // Get pending count
    const pendingCount = await db
      .select({ value: count() })
      .from(waitlist)
      .where(eq(waitlist.status, 'pending'))

    // Get approved count
    const approvedCount = await db
      .select({ value: count() })
      .from(waitlist)
      .where(eq(waitlist.status, 'approved'))

    // Get rejected count
    const rejectedCount = await db
      .select({ value: count() })
      .from(waitlist)
      .where(eq(waitlist.status, 'rejected'))

    // Get total count
    const totalCount = await db.select({ value: count() }).from(waitlist)

    return NextResponse.json({
      success: true,
      stats: {
        pending: pendingCount[0].value,
        approved: approvedCount[0].value,
        rejected: rejectedCount[0].value,
        total: totalCount[0].value,
      },
    })
  } catch (error) {
    logger.error('Error fetching waitlist stats:', error)

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch waitlist statistics',
      },
      { status: 500 }
    )
  }
}
