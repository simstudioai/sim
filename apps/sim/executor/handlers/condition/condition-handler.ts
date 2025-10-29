import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
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
  // Build evaluation context - use provided context or just loop context
  const evalContext = providedEvalContext || {
    // Add loop context if applicable
    ...(context.loopItems.get(block.id) || {}),
  }

  let resolvedConditionValue = conditionExpression
  try {
    // Use full resolution pipeline: variables -> block references -> env vars
    const resolvedVars = resolver.resolveVariableReferences(conditionExpression, block)
    const resolvedRefs = resolver.resolveBlockReferences(resolvedVars, context, block)
    resolvedConditionValue = resolver.resolveEnvVariables(resolvedRefs)
    logger.info(`Resolved condition: from "${conditionExpression}" to "${resolvedConditionValue}"`)
  } catch (resolveError: any) {
    logger.error(`Failed to resolve references in condition: ${resolveError.message}`, {
      conditionExpression,
      resolveError,
    })
    throw new Error(`Failed to resolve references in condition: ${resolveError.message}`)
  }

  // Evaluate the RESOLVED condition string
  try {
    logger.info(`Evaluating resolved condition: "${resolvedConditionValue}"`, { evalContext })
    // IMPORTANT: The resolved value (e.g., "some string".length > 0) IS the code to run
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
  /**
   * PathTracker and resolver are optional - only used by old BFS executor
   * DAG executor handles paths differently
   */
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
      // Log raw inputs before parsing
      rawConditionsInput: inputs.conditions,
    })

    // 1. Parse the conditions JSON string FIRST
    let conditions: Array<{ id: string; title: string; value: string }> = []
    try {
      conditions = Array.isArray(inputs.conditions)
        ? inputs.conditions
        : JSON.parse(inputs.conditions || '[]')
      logger.info('Parsed conditions:', JSON.stringify(conditions, null, 2))
    } catch (error: any) {
      logger.error('Failed to parse conditions JSON:', {
        conditionsInput: inputs.conditions,
        error,
      })
      throw new Error(`Invalid conditions format: ${error.message}`)
    }

    // Find source block for the condition (used for context if needed, maybe remove later)
    const sourceBlockId = context.workflow?.connections.find(
      (conn) => conn.target === block.id
    )?.source

    if (!sourceBlockId) {
      throw new Error(`No source block found for condition block ${block.id}`)
    }

    const sourceOutput = context.blockStates.get(sourceBlockId)?.output
    if (!sourceOutput) {
      throw new Error(`No output found for source block ${sourceBlockId}`)
    }

    // Get source block to derive a dynamic key (maybe remove later)
    const sourceBlock = context.workflow?.blocks.find((b) => b.id === sourceBlockId)
    if (!sourceBlock) {
      throw new Error(`Source block ${sourceBlockId} not found`)
    }

    // Build evaluation context (primarily for potential 'context' object in Function)
    // We might not strictly need sourceKey here if references handle everything
    const evalContext = {
      ...(typeof sourceOutput === 'object' && sourceOutput !== null ? sourceOutput : {}),
      // Add other relevant context if needed, like loop variables
      ...(context.loopItems.get(block.id) || {}), // Example: Add loop context if applicable
    }
    logger.info('Base eval context:', JSON.stringify(evalContext, null, 2))

    // Get outgoing connections
    const outgoingConnections = context.workflow?.connections.filter(
      (conn) => conn.source === block.id
    )

    // Evaluate conditions in order (if, else if, else)
    let selectedConnection: { target: string; sourceHandle?: string } | null = null
    let selectedCondition: { id: string; title: string; value: string } | null = null

    for (const condition of conditions) {
      // Skip 'else' conditions that have no value to evaluate
      if (condition.title === 'else') {
        const connection = outgoingConnections?.find(
          (conn) => conn.sourceHandle === `condition-${condition.id}`
        ) as { target: string; sourceHandle?: string } | undefined
        if (connection) {
          selectedConnection = connection
          selectedCondition = condition
          break // 'else' is always the last path if reached
        }
        continue // Should ideally not happen if 'else' exists and has a connection
      }

      // 2. Evaluate the condition using the shared evaluation function
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

        // Find connection for this condition
        const connection = outgoingConnections?.find(
          (conn) => conn.sourceHandle === `condition-${condition.id}`
        ) as { target: string; sourceHandle?: string } | undefined

        if (connection && conditionMet) {
          selectedConnection = connection
          selectedCondition = condition
          break // Found the first matching condition
        }
      } catch (error: any) {
        logger.error(`Failed to evaluate condition "${condition.title}": ${error.message}`)
        throw new Error(`Evaluation error in condition "${condition.title}": ${error.message}`)
      }
    }

    // Handle case where no condition was met (should only happen if no 'else' exists)
    if (!selectedConnection || !selectedCondition) {
      // Check if an 'else' block exists but wasn't selected (shouldn't happen with current logic)
      const elseCondition = conditions.find((c) => c.title === 'else')
      if (elseCondition) {
        logger.warn(`No condition met, but an 'else' block exists. Selecting 'else' path.`, {
          blockId: block.id,
        })
        const elseConnection = outgoingConnections?.find(
          (conn) => conn.sourceHandle === `condition-${elseCondition.id}`
        ) as { target: string; sourceHandle?: string } | undefined
        if (elseConnection) {
          selectedConnection = elseConnection
          selectedCondition = elseCondition
        } else {
          throw new Error(
            `No path found for condition block "${block.metadata?.name}", and 'else' connection missing.`
          )
        }
      } else {
        throw new Error(
          `No matching path found for condition block "${block.metadata?.name}", and no 'else' block exists.`
        )
      }
    }

    // Find target block
    const targetBlock = context.workflow?.blocks.find((b) => b.id === selectedConnection?.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection?.target} not found`)
    }

    // Log the decision
    logger.info(
      `Condition block ${block.id} selected path: ${selectedCondition.title} (${selectedCondition.id}) -> ${targetBlock.metadata?.name || targetBlock.id}`
    )

    // Update context decisions - use virtual block ID if available (for parallel execution)
    const decisionKey = context.currentVirtualBlockId || block.id
    context.decisions.condition.set(decisionKey, selectedCondition.id)

    // Return output, preserving source output structure if possible
    return {
      ...((sourceOutput as any) || {}), // Keep original fields if they exist
      conditionResult: true, // Indicate a path was successfully chosen
      selectedPath: {
        blockId: targetBlock.id,
        blockType: targetBlock.metadata?.id || 'unknown',
        blockTitle: targetBlock.metadata?.name || 'Untitled Block',
      },
      selectedConditionId: selectedCondition.id,
    }
  }
}
