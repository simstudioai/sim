import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, CONDITION, DEFAULTS, EDGE } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ConditionBlockHandler')

/**
 * Evaluates a single condition expression with variable/block reference resolution
 * Returns true if condition is met, false otherwise
 */
export async function evaluateConditionExpression(
  ctx: ExecutionContext,
  conditionExpression: string,
  block: SerializedBlock,
  resolver: any,
  providedEvalContext?: Record<string, any>
): Promise<boolean> {
  const evalContext = providedEvalContext || {}

  let resolvedConditionValue = conditionExpression
  try {
    if (resolver) {
      const resolvedVars = resolver.resolveVariableReferences(conditionExpression, block)
      const resolvedRefs = resolver.resolveBlockReferences(resolvedVars, ctx, block)
      resolvedConditionValue = resolver.resolveEnvVariables(resolvedRefs)
    }
  } catch (resolveError: any) {
    logger.error(`Failed to resolve references in condition: ${resolveError.message}`, {
      conditionExpression,
      resolveError,
    })
    throw new Error(`Failed to resolve references in condition: ${resolveError.message}`)
  }

  try {
    const conditionMet = new Function(
      'context',
      `with(context) { return ${resolvedConditionValue} }`
    )(evalContext)
    return Boolean(conditionMet)
  } catch (evalError: any) {
    logger.error(`Failed to evaluate condition: ${evalError.message}`, {
      originalCondition: conditionExpression,
      resolvedCondition: resolvedConditionValue,
      evalContext,
      evalError,
    })
    throw new Error(
      `Evaluation error in condition: ${evalError.message}. (Resolved: ${resolvedConditionValue})`
    )
  }
}

/**
 * Handler for Condition blocks that evaluate expressions to determine execution paths.
 */
export class ConditionBlockHandler implements BlockHandler {
  constructor(
    private pathTracker?: any,
    private resolver?: any
  ) {}

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
    const evalContext = this.buildEvaluationContext(ctx, block.id, sourceBlockId)
    const sourceOutput = sourceBlockId ? ctx.blockStates.get(sourceBlockId)?.output : null

    const outgoingConnections = ctx.workflow?.connections.filter((conn) => conn.source === block.id)

    const { selectedConnection, selectedCondition } = await this.evaluateConditions(
      conditions,
      outgoingConnections || [],
      evalContext,
      ctx,
      block
    )

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
      selectedConditionId: selectedCondition.id,
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
    blockId: string,
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
    ctx: ExecutionContext,
    block: SerializedBlock
  ): Promise<{
    selectedConnection: { target: string; sourceHandle?: string }
    selectedCondition: { id: string; title: string; value: string }
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
          block,
          this.resolver,
          evalContext
        )

        const connection = this.findConnectionForCondition(outgoingConnections, condition.id)

        if (connection && conditionMet) {
          return { selectedConnection: connection, selectedCondition: condition }
        }
      } catch (error: any) {
        logger.error(`Failed to evaluate condition "${condition.title}": ${error.message}`)
        throw new Error(`Evaluation error in condition "${condition.title}": ${error.message}`)
      }
    }

    const elseCondition = conditions.find((c) => c.title === CONDITION.ELSE_TITLE)
    if (elseCondition) {
      logger.warn(`No condition met, selecting 'else' path`, { blockId: block.id })
      const elseConnection = this.findConnectionForCondition(outgoingConnections, elseCondition.id)
      if (elseConnection) {
        return { selectedConnection: elseConnection, selectedCondition: elseCondition }
      }
      throw new Error(
        `No path found for condition block "${block.metadata?.name}", and 'else' connection missing.`
      )
    }

    throw new Error(
      `No matching path found for condition block "${block.metadata?.name}", and no 'else' block exists.`
    )
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
