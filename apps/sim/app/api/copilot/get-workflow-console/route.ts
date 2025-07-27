import { desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflowExecutionBlocks, workflowExecutionLogs } from '@/db/schema'

const logger = createLogger('GetWorkflowConsoleAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { workflowId, limit = 50, includeDetails = false } = body

    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    logger.info('Fetching workflow console logs', { workflowId, limit, includeDetails })

    // Get recent execution logs for the workflow
    const executionLogs = await db
      .select({
        id: workflowExecutionLogs.id,
        executionId: workflowExecutionLogs.executionId,
        level: workflowExecutionLogs.level,
        message: workflowExecutionLogs.message,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        blockCount: workflowExecutionLogs.blockCount,
        successCount: workflowExecutionLogs.successCount,
        errorCount: workflowExecutionLogs.errorCount,
        totalCost: workflowExecutionLogs.totalCost,
        metadata: workflowExecutionLogs.metadata,
      })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.workflowId, workflowId))
      .orderBy(desc(workflowExecutionLogs.startedAt))
      .limit(Math.min(limit, 100))

    let blockLogs: any[] = []

    // If we have execution logs and details are requested, get block-level logs
    if (executionLogs.length > 0 && includeDetails) {
      const executionIds = executionLogs.map((log) => log.executionId)

      blockLogs = await db
        .select({
          id: workflowExecutionBlocks.id,
          executionId: workflowExecutionBlocks.executionId,
          blockId: workflowExecutionBlocks.blockId,
          blockName: workflowExecutionBlocks.blockName,
          blockType: workflowExecutionBlocks.blockType,
          status: workflowExecutionBlocks.status,
          errorMessage: workflowExecutionBlocks.errorMessage,
          startedAt: workflowExecutionBlocks.startedAt,
          endedAt: workflowExecutionBlocks.endedAt,
          durationMs: workflowExecutionBlocks.durationMs,
          inputData: workflowExecutionBlocks.inputData,
          outputData: workflowExecutionBlocks.outputData,
          costTotal: workflowExecutionBlocks.costTotal,
          tokensTotal: workflowExecutionBlocks.tokensTotal,
        })
        .from(workflowExecutionBlocks)
        .where(eq(workflowExecutionBlocks.executionId, executionIds[0])) // Get blocks for the most recent execution
        .orderBy(desc(workflowExecutionBlocks.startedAt))
    }

    // Format the response
    const formattedEntries = executionLogs.map((log) => {
      const entry: any = {
        id: log.id,
        executionId: log.executionId,
        level: log.level,
        message: log.message,
        trigger: log.trigger,
        startedAt: log.startedAt,
        endedAt: log.endedAt,
        durationMs: log.totalDurationMs,
        blockCount: log.blockCount,
        successCount: log.successCount,
        errorCount: log.errorCount,
        totalCost: log.totalCost ? Number.parseFloat(log.totalCost.toString()) : null,
        type: 'execution',
      }

      if (log.metadata) {
        entry.metadata = log.metadata
      }

      return entry
    })

    // Add block logs to the most recent execution if details are requested
    if (includeDetails && blockLogs.length > 0) {
      const blockEntries = blockLogs.map((block) => ({
        id: block.id,
        executionId: block.executionId,
        blockId: block.blockId,
        blockName: block.blockName,
        blockType: block.blockType,
        status: block.status,
        success: block.status === 'success',
        error: block.errorMessage,
        startedAt: block.startedAt,
        endedAt: block.endedAt,
        durationMs: block.durationMs,
        input: block.inputData,
        output: block.outputData,
        cost: block.costTotal ? Number.parseFloat(block.costTotal.toString()) : null,
        tokens: block.tokensTotal,
        type: 'block',
      }))

      // Add block entries to the response
      formattedEntries.push(...blockEntries)
    }

    const response = {
      success: true,
      data: {
        entries: formattedEntries,
        totalEntries: formattedEntries.length,
        workflowId,
        retrievedAt: new Date().toISOString(),
        hasBlockDetails: includeDetails && blockLogs.length > 0,
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Failed to get workflow console logs:', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to get console logs: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
