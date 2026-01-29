import { db, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { createSSECallbacks } from '@/lib/workflows/executor/execution-events'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'
import { hasExecutionResult } from '@/executor/utils/errors'

const logger = createLogger('ExecuteFromBlockAPI')

const ExecuteFromBlockSchema = z.object({
  startBlockId: z.string().min(1, 'Start block ID is required'),
  sourceSnapshot: z.object({
    blockStates: z.record(z.any()),
    executedBlocks: z.array(z.string()),
    blockLogs: z.array(z.any()),
    decisions: z.object({
      router: z.record(z.string()),
      condition: z.record(z.string()),
    }),
    completedLoops: z.array(z.string()),
    loopExecutions: z.record(z.any()).optional(),
    parallelExecutions: z.record(z.any()).optional(),
    parallelBlockMapping: z.record(z.any()).optional(),
    activeExecutionPath: z.array(z.string()),
  }),
  input: z.any().optional(),
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id: workflowId } = await params

  try {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }
    const userId = auth.userId

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const validation = ExecuteFromBlockSchema.safeParse(body)
    if (!validation.success) {
      logger.warn(`[${requestId}] Invalid request body:`, validation.error.errors)
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validation.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      )
    }

    const { startBlockId, sourceSnapshot, input } = validation.data
    const executionId = uuidv4()

    const [workflowRecord] = await db
      .select({ workspaceId: workflowTable.workspaceId, userId: workflowTable.userId })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowRecord?.workspaceId) {
      return NextResponse.json({ error: 'Workflow not found or has no workspace' }, { status: 404 })
    }

    const workspaceId = workflowRecord.workspaceId
    const workflowUserId = workflowRecord.userId

    logger.info(`[${requestId}] Starting run-from-block execution`, {
      workflowId,
      startBlockId,
      executedBlocksCount: sourceSnapshot.executedBlocks.length,
    })

    const loggingSession = new LoggingSession(workflowId, executionId, 'manual', requestId)
    const abortController = new AbortController()
    let isStreamClosed = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const { sendEvent, onBlockStart, onBlockComplete, onStream } = createSSECallbacks({
          executionId,
          workflowId,
          controller,
          isStreamClosed: () => isStreamClosed,
          setStreamClosed: () => {
            isStreamClosed = true
          },
        })

        const metadata: ExecutionMetadata = {
          requestId,
          workflowId,
          userId,
          executionId,
          triggerType: 'manual',
          workspaceId,
          workflowUserId,
          useDraftState: true,
          isClientSession: true,
          startTime: new Date().toISOString(),
        }

        const snapshot = new ExecutionSnapshot(metadata, {}, input || {}, {})

        try {
          const startTime = new Date()

          sendEvent({
            type: 'execution:started',
            timestamp: startTime.toISOString(),
            executionId,
            workflowId,
            data: { startTime: startTime.toISOString() },
          })

          const result = await executeWorkflowCore({
            snapshot,
            loggingSession,
            abortSignal: abortController.signal,
            runFromBlock: {
              startBlockId,
              sourceSnapshot: sourceSnapshot as SerializableExecutionState,
            },
            callbacks: { onBlockStart, onBlockComplete, onStream },
          })

          if (result.status === 'cancelled') {
            sendEvent({
              type: 'execution:cancelled',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: { duration: result.metadata?.duration || 0 },
            })
          } else {
            sendEvent({
              type: 'execution:completed',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                success: result.success,
                output: result.output,
                duration: result.metadata?.duration || 0,
                startTime: result.metadata?.startTime || startTime.toISOString(),
                endTime: result.metadata?.endTime || new Date().toISOString(),
              },
            })
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          logger.error(`[${requestId}] Run-from-block execution failed: ${errorMessage}`)

          const executionResult = hasExecutionResult(error) ? error.executionResult : undefined

          sendEvent({
            type: 'execution:error',
            timestamp: new Date().toISOString(),
            executionId,
            workflowId,
            data: {
              error: executionResult?.error || errorMessage,
              duration: executionResult?.metadata?.duration || 0,
            },
          })
        } finally {
          if (!isStreamClosed) {
            try {
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
              controller.close()
            } catch {}
          }
        }
      },
      cancel() {
        isStreamClosed = true
        abortController.abort()
        markExecutionCancelled(executionId).catch(() => {})
      },
    })

    return new NextResponse(stream, {
      headers: { ...SSE_HEADERS, 'X-Execution-Id': executionId },
    })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Failed to start run-from-block execution:`, error)
    return NextResponse.json(
      { error: errorMessage || 'Failed to start execution' },
      { status: 500 }
    )
  }
}
