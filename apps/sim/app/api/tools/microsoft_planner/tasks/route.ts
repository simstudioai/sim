import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { account } from '@/db/schema'
import type { PlannerTask } from '@/tools/microsoft_planner/types'

const logger = createLogger('MicrosoftPlannerTasksAPI')

export async function GET(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const planId = searchParams.get('planId')

    if (!credentialId) {
      logger.error(`[${requestId}] Missing credentialId parameter`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    if (!planId) {
      logger.error(`[${requestId}] Missing planId parameter`)
      return NextResponse.json({ error: 'Plan ID is required' }, { status: 400 })
    }

    // Get the credential from the database
    const credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)

    if (!credentials.length) {
      logger.warn(`[${requestId}] Credential not found`, { credentialId })
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    // Check if the credential belongs to the user
    if (credential.userId !== session.user.id) {
      logger.warn(`[${requestId}] Unauthorized credential access attempt`, {
        credentialUserId: credential.userId,
        requestUserId: session.user.id,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Refresh access token if needed
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)

    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // Fetch tasks directly from Microsoft Graph API
    const response = await fetch(`https://graph.microsoft.com/v1.0/planner/plans/${planId}/tasks`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Microsoft Graph API error:`, errorText)
      return NextResponse.json(
        { error: 'Failed to fetch tasks from Microsoft Graph' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const tasks = data.value || []

    // Filter tasks to only include useful fields (matching our read_task tool)
    const filteredTasks = tasks.map((task: PlannerTask) => ({
      id: task.id,
      title: task.title,
      planId: task.planId,
      bucketId: task.bucketId,
      percentComplete: task.percentComplete,
      priority: task.priority,
      dueDateTime: task.dueDateTime,
      createdDateTime: task.createdDateTime,
      completedDateTime: task.completedDateTime,
      hasDescription: task.hasDescription,
      assignments: task.assignments ? Object.keys(task.assignments) : [],
    }))

    return NextResponse.json({
      tasks: filteredTasks,
      metadata: {
        planId,
        planUrl: `https://graph.microsoft.com/v1.0/planner/plans/${planId}`,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Microsoft Planner tasks:`, error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}
