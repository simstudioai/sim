import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import {
  workflowExecutionBlocks,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@/db/schema'

const logger = createLogger('FrozenCanvasAPI')

export async function GET(request: NextRequest, { params }: { params: { executionId: string } }) {
  try {
    const { executionId } = params

    logger.debug(`Fetching frozen canvas data for execution: ${executionId}`)

    // Get the workflow execution log to find the snapshot
    const [workflowLog] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (!workflowLog) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    // Get the workflow state snapshot
    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId))
      .limit(1)

    if (!snapshot) {
      return NextResponse.json({ error: 'Workflow state snapshot not found' }, { status: 404 })
    }

    // Get all block executions for this execution, ordered by startedAt to maintain iteration order
    const blockExecutions = await db
      .select()
      .from(workflowExecutionBlocks)
      .where(eq(workflowExecutionBlocks.executionId, executionId))
      .orderBy(workflowExecutionBlocks.startedAt)

    // Debug: Log the raw query results
    logger.debug(`Raw block executions query result:`, blockExecutions)
    logger.debug(`Block executions count: ${blockExecutions.length}`)
    if (blockExecutions.length > 0) {
      logger.debug(`Total block executions found: ${blockExecutions.length}`)
      logger.debug(`First block execution:`, blockExecutions[0])

      // Debug: Check for multiple executions of the same blockId
      const blockIdCounts = blockExecutions.reduce(
        (acc, block) => {
          acc[block.blockId] = (acc[block.blockId] || 0) + 1
          return acc
        },
        {} as Record<string, number>
      )

      const multipleIterations = Object.entries(blockIdCounts).filter(([_, count]) => count > 1)
      if (multipleIterations.length > 0) {
        logger.debug(`Blocks with multiple iterations:`, multipleIterations)
      }
    }

    // Initialize blockExecutionMap - we'll populate it from traceSpans primarily
    const blockExecutionMap: Record<string, any> = {}

    // Extract iteration data from traceSpans metadata (primary source)
    if (workflowLog.metadata) {
      const metadata = workflowLog.metadata as any
      if (metadata?.traceSpans && Array.isArray(metadata.traceSpans)) {
        logger.debug('Found traceSpans in metadata, extracting iteration data...')

        // Extract block executions from traceSpans children
        const workflowSpan = metadata.traceSpans[0] // Main workflow span
        if (workflowSpan?.children && Array.isArray(workflowSpan.children)) {
          logger.debug(`Found ${workflowSpan.children.length} trace spans`)

          // Group trace spans by blockId to identify iterations
          const traceSpansByBlockId = workflowSpan.children.reduce((acc: any, span: any) => {
            if (span.blockId) {
              if (!acc[span.blockId]) {
                acc[span.blockId] = []
              }
              acc[span.blockId].push(span)
            }
            return acc
          }, {})

          // Create blockExecutionMap with iteration data from trace spans
          for (const [blockId, spans] of Object.entries(traceSpansByBlockId)) {
            const spanArray = spans as any[]
            logger.debug(`Block ${blockId} has ${spanArray.length} executions in trace spans`)

            // Convert trace spans to execution format and group as iterations
            const iterations = spanArray.map((span: any) => ({
              id: span.id,
              blockId: span.blockId,
              blockName: span.name,
              blockType: span.type,
              status: span.status,
              startedAt: span.startTime,
              endedAt: span.endTime,
              durationMs: span.duration,
              inputData: span.input,
              outputData: span.output,
              errorMessage: null,
              errorStackTrace: null,
              cost: {
                input: null,
                output: null,
                total: null,
              },
              tokens: {
                prompt: null,
                completion: null,
                total: null,
              },
              modelUsed: null,
              metadata: {},
            }))

            // Add to blockExecutionMap with iteration data
            blockExecutionMap[blockId] = {
              iterations,
              currentIteration: 0,
              totalIterations: iterations.length,
            }
          }
        }
      }
    }

    // Supplement with data from workflowExecutionBlocks table if available
    if (blockExecutions.length > 0) {
      logger.debug(
        `Found ${blockExecutions.length} block executions in workflowExecutionBlocks table`
      )

      // Merge database data with traceSpan data where possible
      for (const block of blockExecutions) {
        if (blockExecutionMap[block.blockId]) {
          // Find the matching iteration and supplement with database data
          const iterations = blockExecutionMap[block.blockId].iterations
          const matchingIteration = iterations.find(
            (iter: any) =>
              iter.blockId === block.blockId &&
              Math.abs(new Date(iter.startedAt).getTime() - block.startedAt.getTime()) < 1000 // Within 1 second
          )

          if (matchingIteration) {
            // Supplement with richer data from database
            matchingIteration.cost = {
              input: block.costInput ? Number.parseFloat(block.costInput) : null,
              output: block.costOutput ? Number.parseFloat(block.costOutput) : null,
              total: block.costTotal ? Number.parseFloat(block.costTotal) : null,
            }
            matchingIteration.tokens = {
              prompt: block.tokensPrompt,
              completion: block.tokensCompletion,
              total: block.tokensTotal,
            }
            matchingIteration.modelUsed = block.modelUsed
            matchingIteration.errorMessage = block.errorMessage
            matchingIteration.errorStackTrace = block.errorStackTrace
            matchingIteration.metadata = block.metadata
          }
        }
      }
    }

    const response = {
      executionId,
      workflowId: workflowLog.workflowId,
      workflowState: snapshot.stateData,
      blockExecutions: blockExecutionMap,
      executionMetadata: {
        trigger: workflowLog.trigger,
        startedAt: workflowLog.startedAt.toISOString(),
        endedAt: workflowLog.endedAt?.toISOString(),
        totalDurationMs: workflowLog.totalDurationMs,
        blockStats: {
          total: workflowLog.blockCount,
          success: workflowLog.successCount,
          error: workflowLog.errorCount,
          skipped: workflowLog.skippedCount,
        },
        cost: {
          total: workflowLog.totalCost ? Number.parseFloat(workflowLog.totalCost) : null,
          input: workflowLog.totalInputCost ? Number.parseFloat(workflowLog.totalInputCost) : null,
          output: workflowLog.totalOutputCost
            ? Number.parseFloat(workflowLog.totalOutputCost)
            : null,
        },
        totalTokens: workflowLog.totalTokens,
      },
    }

    logger.debug(`Successfully fetched frozen canvas data for execution: ${executionId}`)
    logger.debug(
      `Workflow state contains ${Object.keys(snapshot.stateData.blocks || {}).length} blocks`
    )
    logger.debug(`Found ${blockExecutions.length} block executions`)
    logger.debug(`Workflow log metadata:`, workflowLog.metadata)

    // Debug: Log the actual snapshot data structure
    logger.debug(`Snapshot state data:`, {
      snapshotId: snapshot.id,
      stateData: snapshot.stateData,
      blockTypes: Object.entries(snapshot.stateData.blocks || {}).map(([id, block]) => ({
        id,
        type: (block as any)?.type,
        hasType: !!(block as any)?.type,
      })),
    })

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Error fetching frozen canvas data:', error)
    return NextResponse.json({ error: 'Failed to fetch frozen canvas data' }, { status: 500 })
  }
}
