import { db, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { type ExecutionEvent, encodeSSEEvent } from '@/lib/workflows/executor/execution-events'
import { DAGExecutor } from '@/executor/execution/executor'
import type { IterationContext, SerializableExecutionState } from '@/executor/execution/types'
import type { NormalizedBlockOutput } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { Serializer } from '@/serializer'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

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
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/workflows/[id]/execute-from-block
 *
 * Executes a workflow starting from a specific block using cached outputs
 * for upstream/unaffected blocks from the source snapshot.
 */
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

    const { startBlockId, sourceSnapshot } = validation.data

    logger.info(`[${requestId}] Starting run-from-block execution`, {
      workflowId,
      userId,
      startBlockId,
      executedBlocksCount: sourceSnapshot.executedBlocks.length,
    })

    const executionId = uuidv4()

    // Load workflow record to get workspaceId
    const [workflowRecord] = await db
      .select({ workspaceId: workflowTable.workspaceId })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowRecord?.workspaceId) {
      return NextResponse.json({ error: 'Workflow not found or has no workspace' }, { status: 404 })
    }

    const workspaceId = workflowRecord.workspaceId

    // Load workflow state
    const workflowData = await loadWorkflowFromNormalizedTables(workflowId)
    if (!workflowData) {
      return NextResponse.json({ error: 'Workflow state not found' }, { status: 404 })
    }

    const { blocks, edges, loops, parallels } = workflowData

    // Merge block states
    const mergedStates = mergeSubblockState(blocks)

    // Get environment variables
    const { personalDecrypted, workspaceDecrypted } = await getPersonalAndWorkspaceEnv(
      userId,
      workspaceId
    )
    const decryptedEnvVars: Record<string, string> = { ...personalDecrypted, ...workspaceDecrypted }

    // Serialize workflow
    const serializedWorkflow = new Serializer().serializeWorkflow(
      mergedStates,
      edges,
      loops,
      parallels,
      true
    )

    const encoder = new TextEncoder()
    const abortController = new AbortController()
    let isStreamClosed = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (event: ExecutionEvent) => {
          if (isStreamClosed) return

          try {
            controller.enqueue(encodeSSEEvent(event))
          } catch {
            isStreamClosed = true
          }
        }

        try {
          const startTime = new Date()

          sendEvent({
            type: 'execution:started',
            timestamp: startTime.toISOString(),
            executionId,
            workflowId,
            data: {
              startTime: startTime.toISOString(),
            },
          })

          const onBlockStart = async (
            blockId: string,
            blockName: string,
            blockType: string,
            iterationContext?: IterationContext
          ) => {
            sendEvent({
              type: 'block:started',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                blockId,
                blockName,
                blockType,
                ...(iterationContext && {
                  iterationCurrent: iterationContext.iterationCurrent,
                  iterationTotal: iterationContext.iterationTotal,
                  iterationType: iterationContext.iterationType,
                }),
              },
            })
          }

          const onBlockComplete = async (
            blockId: string,
            blockName: string,
            blockType: string,
            callbackData: { input?: unknown; output: NormalizedBlockOutput; executionTime: number },
            iterationContext?: IterationContext
          ) => {
            const hasError = (callbackData.output as any)?.error

            if (hasError) {
              sendEvent({
                type: 'block:error',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  blockId,
                  blockName,
                  blockType,
                  input: callbackData.input,
                  error: (callbackData.output as any).error,
                  durationMs: callbackData.executionTime || 0,
                  ...(iterationContext && {
                    iterationCurrent: iterationContext.iterationCurrent,
                    iterationTotal: iterationContext.iterationTotal,
                    iterationType: iterationContext.iterationType,
                  }),
                },
              })
            } else {
              sendEvent({
                type: 'block:completed',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: {
                  blockId,
                  blockName,
                  blockType,
                  input: callbackData.input,
                  output: callbackData.output,
                  durationMs: callbackData.executionTime || 0,
                  ...(iterationContext && {
                    iterationCurrent: iterationContext.iterationCurrent,
                    iterationTotal: iterationContext.iterationTotal,
                    iterationType: iterationContext.iterationType,
                  }),
                },
              })
            }
          }

          const onStream = async (streamingExecution: unknown) => {
            const streamingExec = streamingExecution as { stream: ReadableStream; execution: any }
            const blockId = streamingExec.execution?.blockId

            const reader = streamingExec.stream.getReader()
            const decoder = new TextDecoder()

            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value, { stream: true })
                sendEvent({
                  type: 'stream:chunk',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: { blockId, chunk },
                })
              }

              sendEvent({
                type: 'stream:done',
                timestamp: new Date().toISOString(),
                executionId,
                workflowId,
                data: { blockId },
              })
            } catch (error) {
              logger.error(`[${requestId}] Error streaming block content:`, error)
            } finally {
              try {
                reader.releaseLock()
              } catch {}
            }
          }

          // Create executor and run from block
          const executor = new DAGExecutor({
            workflow: serializedWorkflow,
            envVarValues: decryptedEnvVars,
            workflowInput: {},
            workflowVariables: {},
            contextExtensions: {
              stream: true,
              executionId,
              workspaceId,
              userId,
              isDeployedContext: false,
              onBlockStart,
              onBlockComplete,
              onStream,
              abortSignal: abortController.signal,
            },
          })

          const result = await executor.executeFromBlock(
            workflowId,
            startBlockId,
            sourceSnapshot as SerializableExecutionState
          )

          if (result.status === 'cancelled') {
            sendEvent({
              type: 'execution:cancelled',
              timestamp: new Date().toISOString(),
              executionId,
              workflowId,
              data: {
                duration: result.metadata?.duration || 0,
              },
            })
            return
          }

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
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            } catch {
              // Stream already closed
            }
          }
        }
      },
      cancel() {
        isStreamClosed = true
        logger.info(`[${requestId}] Client aborted SSE stream, signalling cancellation`)
        abortController.abort()
        markExecutionCancelled(executionId).catch(() => {})
      },
    })

    return new NextResponse(stream, {
      headers: {
        ...SSE_HEADERS,
        'X-Execution-Id': executionId,
      },
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
