import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { persistExecutionLogs, persistLog } from '@/lib/logs/execution-logger'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'
import { db } from '@/db'
import { desc, eq } from 'drizzle-orm'
import { workflow, workflowLogs } from '@/db/schema'

const logger = createLogger('WorkflowLogAPI')

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    // Validate workflow ID
    if (!id) {
      return NextResponse.json(
        { error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    // First get the workflow details
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, id))
      .limit(1)

    if (!workflowData || workflowData.length === 0) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      )
    }

    // Then get the logs
    const logs = await db
      .select()
      .from(workflowLogs)
      .where(eq(workflowLogs.workflowId, id))
      .orderBy(desc(workflowLogs.createdAt))

    // Transform logs to include workflow name and success status
    const transformedLogs = logs.map(log => ({
      ...log,
      workflowName: workflowData[0]?.name || 'Unknown Workflow',
      success: log.duration !== 'NA' && log.level !== 'error',
      // Map camelCase to snake_case for frontend compatibility
      workflow_id: log.workflowId,
      execution_id: log.executionId || 'N/A',
      created_at: log.createdAt instanceof Date 
        ? log.createdAt.toISOString() 
        : new Date().toISOString()
    }))

    return NextResponse.json({ logs: transformedLogs })
  } catch (error) {
    console.error('Error fetching workflow logs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workflow logs' },
      { status: 500 }
    )
  }
} 

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json()
    const { logs, executionId, result } = body

    // If result is provided, use persistExecutionLogs for full tool call extraction
    if (result) {
      logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
        executionId,
        success: result.success,
      })

      // Use persistExecutionLogs which handles tool call extraction
      await persistExecutionLogs(id, executionId, result, 'manual')

      return createSuccessResponse({
        message: 'Execution logs persisted successfully',
      })
    }

    // Fall back to the original log format if 'result' isn't provided
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      logger.warn(`[${requestId}] No logs provided for workflow: ${id}`)
      return createErrorResponse('No logs provided', 400)
    }

    logger.info(`[${requestId}] Persisting ${logs.length} logs for workflow: ${id}`, {
      executionId,
    })

    // Persist each log using the original method
    for (const log of logs) {
      await persistLog({
        id: uuidv4(),
        workflowId: id,
        executionId,
        level: log.level,
        message: log.message,
        duration: log.duration,
        trigger: log.trigger || 'manual',
        createdAt: new Date(log.createdAt || new Date()),
        metadata: log.metadata,
      })
    }

    return createSuccessResponse({ message: 'Logs persisted successfully' })
  } catch (error: any) {
    logger.error(`[${requestId}] Error persisting logs for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to persist logs', 500)
  }
}
