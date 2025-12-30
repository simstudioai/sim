import { createLogger } from '@sim/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, CONDITION, DEFAULTS, EDGE } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

const logger = createLogger('ConditionBlockHandler')

const CONDITION_TIMEOUT_MS = 5000

/**
 * Evaluates a single condition expression.
 * Variable resolution is handled consistently with the function block via the function_execute tool.
 * Returns true if condition is met, false otherwise.
 */
export async function evaluateConditionExpression(
  ctx: ExecutionContext,
  conditionExpression: string,
  providedEvalContext?: Record<string, any>
): Promise<boolean> {
  const evalContext = providedEvalContext || {}

  try {
    const contextSetup = `const context = ${JSON.stringify(evalContext)};`
    const code = `${contextSetup}\nreturn Boolean(${conditionExpression})`

    const { blockData, blockNameMapping } = collectBlockData(ctx)

    const result = await executeTool(
      'function_execute',
      {
        code,
        timeout: CONDITION_TIMEOUT_MS,
        envVars: ctx.environmentVariables || {},
        workflowVariables: ctx.workflowVariables || {},
        blockData,
        blockNameMapping,
        _context: {
          workflowId: ctx.workflowId,
          workspaceId: ctx.workspaceId,
        },
      },
      false,
      false,
      ctx
    )

    if (!result.success) {
      logger.error(`Failed to evaluate condition: ${result.error}`, {
        originalCondition: conditionExpression,
        evalContext,
        error: result.error,
      })
      throw new Error(`Evaluation error in condition: ${result.error}`)
    }

    return Boolean(result.output?.result)
  } catch (evalError: any) {
    logger.error(`Failed to evaluate condition: ${evalError.message}`, {
      originalCondition: conditionExpression,
      evalContext,
      evalError,
    })
    throw new Error(`Evaluation error in condition: ${evalError.message}`)
  }
}

/**
 * Handler for Condition blocks that evaluate expressions to determine execution paths.
 */
export class ConditionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.CONDITION
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const conditions = this.parseConditions(inputs.conditions)

    const sourceBlockId = ctx.workflow?.connections.find((conn) => conn.target === block.id)?.source
    const evalContext = this.buildEvaluationContext(ctx, sourceBlockId)
    const sourceOutput = sourceBlockId ? ctx.blockStates.get(sourceBlockId)?.output : null

    const outgoingConnections = ctx.workflow?.connections.filter((conn) => conn.source === block.id)

    const { selectedConnection, selectedCondition } = await this.evaluateConditions(
      conditions,
      outgoingConnections || [],
      evalContext,
      ctx
    )

    if (!selectedConnection || !selectedCondition) {
      return {
        ...((sourceOutput as any) || {}),
        conditionResult: false,
        selectedPath: null,
        selectedOption: null,
      }
    }

    const targetBlock = ctx.workflow?.blocks.find((b) => b.id === selectedConnection?.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection?.target} not found`)
    }

    const decisionKey = ctx.currentVirtualBlockId || block.id
    ctx.decisions.condition.set(decisionKey, selectedCondition.id)

    return {
      ...((sourceOutput as any) || {}),
      conditionResult: true,
      selectedPath: {
        blockId: targetBlock.id,
        blockType: targetBlock.metadata?.id || DEFAULTS.BLOCK_TYPE,
        blockTitle: targetBlock.metadata?.name || DEFAULTS.BLOCK_TITLE,
      },
      selectedOption: selectedCondition.id,
    }
  }

  private parseConditions(input: any): Array<{ id: string; title: string; value: string }> {
    try {
      const conditions = Array.isArray(input) ? input : JSON.parse(input || '[]')
      return conditions
    } catch (error: any) {
      logger.error('Failed to parse conditions:', { input, error })
      throw new Error(`Invalid conditions format: ${error.message}`)
    }
  }

  private buildEvaluationContext(
    ctx: ExecutionContext,
    sourceBlockId?: string
  ): Record<string, any> {
    let evalContext: Record<string, any> = {}

    if (sourceBlockId) {
      const sourceOutput = ctx.blockStates.get(sourceBlockId)?.output
      if (sourceOutput && typeof sourceOutput === 'object' && sourceOutput !== null) {
        evalContext = {
          ...evalContext,
          ...sourceOutput,
        }
      }
    }

    return evalContext
  }

  private async evaluateConditions(
    conditions: Array<{ id: string; title: string; value: string }>,
    outgoingConnections: Array<{ source: string; target: string; sourceHandle?: string }>,
    evalContext: Record<string, any>,
    ctx: ExecutionContext
  ): Promise<{
    selectedConnection: { target: string; sourceHandle?: string } | null
    selectedCondition: { id: string; title: string; value: string } | null
  }> {
    for (const condition of conditions) {
      if (condition.title === CONDITION.ELSE_TITLE) {
        const connection = this.findConnectionForCondition(outgoingConnections, condition.id)
        if (connection) {
          return { selectedConnection: connection, selectedCondition: condition }
        }
        continue
      }

      const conditionValueString = String(condition.value || '')
      try {
        const conditionMet = await evaluateConditionExpression(
          ctx,
          conditionValueString,
          evalContext
        )

        if (conditionMet) {
          const connection = this.findConnectionForCondition(outgoingConnections, condition.id)
          if (connection) {
            return { selectedConnection: connection, selectedCondition: condition }
          }
          // Condition is true but has no outgoing edge - branch ends gracefully
          return { selectedConnection: null, selectedCondition: null }
        }
      } catch (error: any) {
        logger.error(`Failed to evaluate condition "${condition.title}": ${error.message}`)
        throw new Error(`Evaluation error in condition "${condition.title}": ${error.message}`)
      }
    }

    const elseCondition = conditions.find((c) => c.title === CONDITION.ELSE_TITLE)
    if (elseCondition) {
      const elseConnection = this.findConnectionForCondition(outgoingConnections, elseCondition.id)
      if (elseConnection) {
        return { selectedConnection: elseConnection, selectedCondition: elseCondition }
      }
      return { selectedConnection: null, selectedCondition: null }
    }

    return { selectedConnection: null, selectedCondition: null }
  }

  private findConnectionForCondition(
    connections: Array<{ source: string; target: string; sourceHandle?: string }>,
    conditionId: string
  ): { target: string; sourceHandle?: string } | undefined {
    return connections.find(
      (conn) => conn.sourceHandle === `${EDGE.CONDITION_PREFIX}${conditionId}`
    )
  }
}
