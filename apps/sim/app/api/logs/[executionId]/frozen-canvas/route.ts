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

    // Get all block executions for this execution
    const blockExecutions = await db
      .select()
      .from(workflowExecutionBlocks)
      .where(eq(workflowExecutionBlocks.executionId, executionId))

    // Debug: Log the raw query results
    logger.debug(`Raw block executions query result:`, blockExecutions)
    logger.debug(`Block executions count: ${blockExecutions.length}`)
    if (blockExecutions.length > 0) {
      logger.debug(`First block execution:`, blockExecutions[0])
    }

    // Transform block executions into a map for easy lookup
    let blockExecutionMap = blockExecutions.reduce(
      (acc, block) => {
        acc[block.blockId] = {
          id: block.id,
          blockId: block.blockId,
          blockName: block.blockName,
          blockType: block.blockType,
          status: block.status,
          startedAt: block.startedAt.toISOString(),
          endedAt: block.endedAt?.toISOString(),
          durationMs: block.durationMs,
          inputData: block.inputData,
          outputData: block.outputData,
          errorMessage: block.errorMessage,
          errorStackTrace: block.errorStackTrace,
          cost: {
            input: block.costInput ? Number.parseFloat(block.costInput) : null,
            output: block.costOutput ? Number.parseFloat(block.costOutput) : null,
            total: block.costTotal ? Number.parseFloat(block.costTotal) : null,
          },
          tokens: {
            prompt: block.tokensPrompt,
            completion: block.tokensCompletion,
            total: block.tokensTotal,
          },
          modelUsed: block.modelUsed,
          metadata: block.metadata,
        }
        return acc
      },
      {} as Record<string, any>
    )

    // If no block executions found in workflowExecutionBlocks table,
    // try to extract from workflowExecutionLogs metadata
    if (blockExecutions.length === 0 && workflowLog.metadata) {
      logger.debug('No block executions in workflowExecutionBlocks, checking metadata...')

      // Check if metadata contains block execution data
      const metadata = workflowLog.metadata as any
      if (metadata?.traceSpans && Array.isArray(metadata.traceSpans)) {
        logger.debug('Found traceSpans in metadata, extracting block executions...')

        // Extract block executions from traceSpans children
        const workflowSpan = metadata.traceSpans[0] // Main workflow span
        if (workflowSpan?.children && Array.isArray(workflowSpan.children)) {
          logger.debug(`Found ${workflowSpan.children.length} child spans in workflow span`)

          blockExecutionMap = workflowSpan.children.reduce((acc: any, span: any) => {
            if (span.blockId) {
              acc[span.blockId] = {
                id: span.id,
                blockId: span.blockId,
                blockName: span.name || span.blockId,
                blockType: span.type,
                status: span.status === 'success' ? 'success' : 'error',
                startedAt: span.startTime,
                endedAt: span.endTime,
                durationMs: span.duration,
                inputData: span.input || {},
                outputData: span.output || {},
                errorMessage: span.status === 'error' ? 'Execution failed' : null,
                errorStackTrace: null,
                cost: {
                  input: span.cost?.input || null,
                  output: span.cost?.output || null,
                  total: span.cost?.total || null,
                },
                tokens: {
                  prompt: span.tokens?.prompt || null,
                  completion: span.tokens?.completion || null,
                  total: span.tokens?.total || null,
                },
                modelUsed: span.model || null,
                metadata: {},
              }
            }
            return acc
          }, {})

          logger.debug(
            `Extracted ${Object.keys(blockExecutionMap).length} block executions from traceSpans children`
          )
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
