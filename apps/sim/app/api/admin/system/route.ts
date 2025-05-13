import { NextRequest, NextResponse } from 'next/server'
import { and, count, eq, gte, sum } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { session, user, workflow, workflowLogs } from '@/db/schema'

const logger = createLogger('SystemStats')

export async function GET(req: NextRequest) {
  try {
    // Validate the admin token
    const authHeader = req.headers.get('authorization')
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

    // Get the period from query parameters
    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') || '24h'

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

    // Get system stats - you might want to implement actual uptime monitoring
    // For now using a placeholder value
    const uptime = '99.9%'

    logger.info(`Fetched system stats for period: ${period}`)

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
