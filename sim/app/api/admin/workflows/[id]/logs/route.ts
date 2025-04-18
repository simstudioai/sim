import { NextResponse } from 'next/server'
import { db } from '@/db'
import { workflow, workflowLogs } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Ensure params is properly awaited
    const workflowId = await Promise.resolve(params.id)
    if (!workflowId) {
      return NextResponse.json(
        { error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    // First get the workflow details
    const workflowData = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
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
      .where(eq(workflowLogs.workflowId, workflowId))
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