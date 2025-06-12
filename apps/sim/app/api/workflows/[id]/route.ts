import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workspaceMember } from '@/db/schema'

const logger = createLogger('WorkflowDetailAPI')

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()

  try {
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workflowId } = await params

    if (!workflowId) {
      return NextResponse.json({ error: 'Workflow ID is required' }, { status: 400 })
    }

    // Fetch the workflow from database
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .then((rows) => rows[0])

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has access to this workflow
    // User can access if they own it OR if it's in a workspace they're part of
    const canAccess = workflowData.userId === session.user.id

    if (!canAccess && workflowData.workspaceId) {
      // Check workspace membership
      const membership = await db
        .select()
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, workflowData.workspaceId),
            eq(workspaceMember.userId, session.user.id)
          )
        )
        .then((rows) => rows[0])

      if (membership) {
        // User is a member of the workspace, allow access
        const elapsed = Date.now() - startTime
        logger.info(`[${requestId}] Workflow ${workflowId} fetched in ${elapsed}ms`)
        return NextResponse.json({ data: workflowData }, { status: 200 })
      }
    } else if (canAccess) {
      // User owns the workflow, allow access
      const elapsed = Date.now() - startTime
      logger.info(`[${requestId}] Workflow ${workflowId} fetched in ${elapsed}ms`)
      return NextResponse.json({ data: workflowData }, { status: 200 })
    }

    logger.warn(
      `[${requestId}] User ${session.user.id} attempted to access workflow ${workflowId} without permission`
    )
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error fetching workflow after ${elapsed}ms:`, error)
    return NextResponse.json({ error: 'Failed to fetch workflow' }, { status: 500 })
  }
}
