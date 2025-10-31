import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, CONDITION, DEFAULTS, EDGE } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { parseJSON } from '@/executor/utils/json'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ConditionBlockHandler')

/**
 * Evaluates a single condition expression with variable/block reference resolution
 * Returns true if condition is met, false otherwise
 */
export async function evaluateConditionExpression(
  conditionExpression: string,
  context: ExecutionContext,
  block: SerializedBlock,
  resolver: any,
  providedEvalContext?: Record<string, any>
): Promise<boolean> {
  const evalContext = providedEvalContext || {
    ...(context.loopItems.get(block.id) || {}),
  }

  let resolvedConditionValue = conditionExpression
  try {
    if (resolver) {
      const resolvedVars = resolver.resolveVariableReferences(conditionExpression, block)
      const resolvedRefs = resolver.resolveBlockReferences(resolvedVars, context, block)
      resolvedConditionValue = resolver.resolveEnvVariables(resolvedRefs)
      logger.info(
        `Resolved condition: from "${conditionExpression}" to "${resolvedConditionValue}"`
      )
    }
  } catch (resolveError: any) {
    logger.error(`Failed to resolve references in condition: ${resolveError.message}`, {
      conditionExpression,
      resolveError,
    })
    throw new Error(`Failed to resolve references in condition: ${resolveError.message}`)
  }

  try {
    logger.info(`Evaluating resolved condition: "${resolvedConditionValue}"`, { evalContext })
    const conditionMet = new Function(
      'context',
      `with(context) { return ${resolvedConditionValue} }`
    )(evalContext)
    logger.info(`Condition evaluated to: ${conditionMet}`)
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
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    logger.info(`Executing condition block: ${block.id}`, {
      rawConditionsInput: inputs.conditions,
    })

    const conditions = this.parseConditions(inputs.conditions)

    const sourceBlockId = context.workflow?.connections.find(
      (conn) => conn.target === block.id
    )?.source
    const evalContext = this.buildEvaluationContext(context, block.id, sourceBlockId)
    const sourceOutput = sourceBlockId ? context.blockStates.get(sourceBlockId)?.output : null

    const outgoingConnections = context.workflow?.connections.filter(
      (conn) => conn.source === block.id
    )

    const { selectedConnection, selectedCondition } = await this.evaluateConditions(
      conditions,
      outgoingConnections || [],
      evalContext,
      context,
      block
    )

    const targetBlock = context.workflow?.blocks.find((b) => b.id === selectedConnection?.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection?.target} not found`)
    }

    logger.info(
      `Condition block ${block.id} selected path: ${selectedCondition.title} (${selectedCondition.id}) -> ${targetBlock.metadata?.name || targetBlock.id}`
    )

    const decisionKey = context.currentVirtualBlockId || block.id
    context.decisions.condition.set(decisionKey, selectedCondition.id)

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
      const conditions = Array.isArray(input) ? input : parseJSON(input, [])
      logger.info('Parsed conditions:', conditions)
      return conditions
    } catch (error: any) {
      logger.error('Failed to parse conditions:', { input, error })
      throw new Error(`Invalid conditions format: ${error.message}`)
    }
  }

  private buildEvaluationContext(
    context: ExecutionContext,
    blockId: string,
    sourceBlockId?: string
  ): Record<string, any> {
    let evalContext: Record<string, any> = {
      ...(context.loopItems.get(blockId) || {}),
    }

    if (sourceBlockId) {
      const sourceOutput = context.blockStates.get(sourceBlockId)?.output
      if (sourceOutput && typeof sourceOutput === 'object' && sourceOutput !== null) {
        evalContext = {
          ...evalContext,
          ...sourceOutput,
        }
      }
    }

    logger.info('Base eval context:', evalContext)
    return evalContext
  }

  private async evaluateConditions(
    conditions: Array<{ id: string; title: string; value: string }>,
    outgoingConnections: Array<{ source: string; target: string; sourceHandle?: string }>,
    evalContext: Record<string, any>,
    context: ExecutionContext,
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
          conditionValueString,
          context,
          block,
          this.resolver,
          evalContext
        )
        logger.info(`Condition "${condition.title}" (${condition.id}) met: ${conditionMet}`)

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
