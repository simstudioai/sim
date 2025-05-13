import { NextRequest, NextResponse } from 'next/server'
import { count, gte } from 'drizzle-orm'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { session, user, workflow, workflowLogs } from '@/db/schema'
import { isAuthorized } from '../utils'

const logger = createLogger('SystemStats')

const systemStatsQuerySchema = z.object({
  period: z.enum(['24h', '7d', '30d']).default('24h'),
})

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const periodParam = searchParams.get('period') || '24h'

    const validatedParams = systemStatsQuerySchema.safeParse({
      period: periodParam,
    })

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

    const { period } = validatedParams.data

    // Get total users count
    const totalUsers = await db
      .select({ count: count() })
      .from(user)
      .then((res) => res[0].count)

    // Calculate the date threshold based on the period
    let dateThreshold = new Date()
    if (period === '24h') {
      dateThreshold.setDate(dateThreshold.getDate() - 1)
    } else if (period === '7d') {
      dateThreshold.setDate(dateThreshold.getDate() - 7)
    } else if (period === '30d') {
      dateThreshold.setDate(dateThreshold.getDate() - 30)
    }

    // Get active users based on the selected period
    const activeUsers = await db
      .select({ count: count() })
      .from(session)
      .where(gte(session.updatedAt, dateThreshold))
      .then((res) => res[0].count)

    // Get total workflows
    const totalWorkflows = await db
      .select({ count: count() })
      .from(workflow)
      .then((res) => res[0].count)

    // Get total workflow executions
    const totalExecutions = await db
      .select({ sum: count() })
      .from(workflowLogs)
      .then((res) => res[0].sum)

    // TODO: GET SYSTEM UPTIME, USING PLACEHOLDER VALUE
    const uptime = '99.9%'

    return NextResponse.json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        totalWorkflows,
        totalExecutions,
        uptime,
        period,
      },
    })
  } catch (error) {
    logger.error('Error fetching system stats:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch system stats',
      },
      { status: 500 }
    )
  }
}
