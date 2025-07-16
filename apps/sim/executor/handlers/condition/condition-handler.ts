import { createLogger } from '@/lib/logs/console-logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type { PathTracker } from '@/executor/path/path'
import type { InputResolver } from '@/executor/resolver/resolver'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ConditionBlockHandler')

/**
 * Handler for Condition blocks that evaluate expressions to determine execution paths.
 */
export class ConditionBlockHandler implements BlockHandler {
  /**
   * @param pathTracker - Utility for tracking execution paths
   * @param resolver - Utility for resolving inputs
   */
  constructor(
    private pathTracker: PathTracker,
    private resolver: InputResolver
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

      // 2. Resolve references WITHIN the specific condition's value string
      let resolvedConditionValue = condition.value
      try {
        // Use the resolver instance to process block references within the condition string
        resolvedConditionValue = this.resolver.resolveBlockReferences(
          condition.value,
          context,
          block // Pass the current condition block as context
        )
        logger.info(
          `Resolved condition "${condition.title}" (${condition.id}): from "${condition.value}" to "${resolvedConditionValue}"`
        )
      } catch (resolveError: any) {
        logger.error(`Failed to resolve references in condition: ${resolveError.message}`, {
          condition,
          resolveError,
        })
        throw new Error(`Failed to resolve references in condition: ${resolveError.message}`)
      }

      // 3. Evaluate the RESOLVED condition string
      try {
        logger.info(`Evaluating resolved condition: "${resolvedConditionValue}"`, {
          evalContext, // Log the context being used for evaluation
        })
        // IMPORTANT: The resolved value (e.g., "some string".length > 0) IS the code to run
        const conditionMet = new Function(
          'context',
          `with(context) { return ${resolvedConditionValue} }`
        )(evalContext)
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
      } catch (evalError: any) {
        logger.error(`Failed to evaluate condition: ${evalError.message}`, {
          originalCondition: condition.value,
          resolvedCondition: resolvedConditionValue,
          evalContext,
          evalError,
        })
        // Construct a more informative error message
        throw new Error(
          `Evaluation error in condition "${condition.title}": ${evalError.message}. (Resolved: ${resolvedConditionValue})`
        )
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

    // Update context decisions
    context.decisions.condition.set(block.id, selectedCondition.id)

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
