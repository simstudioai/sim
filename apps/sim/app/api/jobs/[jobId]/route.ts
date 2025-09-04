import { runs } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { createErrorResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { apiKey as apiKeyTable } from '@/db/schema'

const logger = createLogger('TaskStatusAPI')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId: taskId } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Getting status for task: ${taskId}`)

    // Try session auth first (for web UI)
    const session = await getSession()
    let authenticatedUserId: string | null = session?.user?.id || null

    if (!authenticatedUserId) {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        const [apiKeyRecord] = await db
          .select({ userId: apiKeyTable.userId })
          .from(apiKeyTable)
          .where(eq(apiKeyTable.key, apiKeyHeader))
          .limit(1)

        if (apiKeyRecord) {
          authenticatedUserId = apiKeyRecord.userId
        }
      }
    }

    if (!authenticatedUserId) {
      return createErrorResponse('Authentication required', 401)
    }

    // Fetch task status from Trigger.dev
    const run = await runs.retrieve(taskId)

    logger.debug(`[${requestId}] Task ${taskId} status: ${run.status}`)

    // Map Trigger.dev status to our format
    const statusMap = {
      QUEUED: 'queued',
      WAITING_FOR_DEPLOY: 'queued',
      EXECUTING: 'processing',
      RESCHEDULED: 'processing',
      FROZEN: 'processing',
      COMPLETED: 'completed',
      CANCELED: 'cancelled',
      FAILED: 'failed',
      CRASHED: 'failed',
      INTERRUPTED: 'failed',
      SYSTEM_FAILURE: 'failed',
      EXPIRED: 'failed',
    } as const

    const mappedStatus = statusMap[run.status as keyof typeof statusMap] || 'unknown'

    // Build response based on status
    const response: any = {
      success: true,
      taskId,
      status: mappedStatus,
      metadata: {
        startedAt: run.startedAt,
      },
    }

    // Add completion details if finished
    if (mappedStatus === 'completed') {
      response.output = run.output // This contains the workflow execution results
      response.metadata.completedAt = run.finishedAt
      response.metadata.duration = run.durationMs
    }

    // Add error details if failed
    if (mappedStatus === 'failed') {
      response.error = run.error
      response.metadata.completedAt = run.finishedAt
      response.metadata.duration = run.durationMs
    }

    // Add progress info if still processing
    if (mappedStatus === 'processing' || mappedStatus === 'queued') {
      response.estimatedDuration = 180000 // 3 minutes max from our config
    }

    return NextResponse.json(response)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching task status:`, error)

    if (error.message?.includes('not found') || error.status === 404) {
      return createErrorResponse('Task not found', 404)
    }

    return createErrorResponse('Failed to fetch task status', 500)
  }
}

// TODO: Implement task cancellation via Trigger.dev API if needed
// export async function DELETE() { ... }
