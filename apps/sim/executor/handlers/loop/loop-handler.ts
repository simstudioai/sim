import { createLogger } from '@/lib/logs/console-logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type { PathTracker } from '@/executor/path/path'
import type { InputResolver } from '@/executor/resolver/resolver'
import { Routing } from '@/executor/routing/routing'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('LoopBlockHandler')

const DEFAULT_MAX_ITERATIONS = 5

/**
 * Handler for loop blocks that manage iteration control and flow.
 * Loop blocks don't execute logic themselves but control the flow of blocks within them.
 */
export class LoopBlockHandler implements BlockHandler {
  constructor(
    private resolver?: InputResolver,
    private pathTracker?: PathTracker
  ) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.LOOP
  }

  async execute(
    block: SerializedBlock,
    _inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    logger.info(`Executing loop block: ${block.id}`)

    // Get the loop configuration from the workflow
    const loop = context.workflow?.loops?.[block.id]
    if (!loop) {
      logger.error(`Loop configuration not found for block ${block.id}`, {
        blockId: block.id,
        availableLoops: Object.keys(context.workflow?.loops || {}),
        workflowLoops: context.workflow?.loops,
      })
      throw new Error(`Loop configuration not found for block ${block.id}`)
    }

    // Initialize loop iteration if not already done
    if (!context.loopIterations.has(block.id)) {
      context.loopIterations.set(block.id, 0)
      logger.info(`Initialized loop ${block.id} with 0 iterations`)
    }

    const currentIteration = context.loopIterations.get(block.id) || 0
    let maxIterations: number
    let forEachItems: any[] | Record<string, any> | null = null
    if (loop.loopType === 'forEach') {
      if (
        !loop.forEachItems ||
        (typeof loop.forEachItems === 'string' && loop.forEachItems.trim() === '')
      ) {
        throw new Error(
          `forEach loop "${block.id}" requires a collection to iterate over. Please provide an array or object in the collection field.`
        )
      }

      forEachItems = await this.evaluateForEachItems(loop.forEachItems, context, block)
      logger.info(`Evaluated forEach items for loop ${block.id}:`, forEachItems)

      if (
        !forEachItems ||
        (Array.isArray(forEachItems) && forEachItems.length === 0) ||
        (typeof forEachItems === 'object' && Object.keys(forEachItems).length === 0)
      ) {
        throw new Error(
          `forEach loop "${block.id}" collection is empty or invalid. Please provide a non-empty array or object.`
        )
      }

      // For forEach, max iterations = items length
      const itemsLength = Array.isArray(forEachItems)
        ? forEachItems.length
        : Object.keys(forEachItems).length

      maxIterations = itemsLength

      logger.info(
        `forEach loop ${block.id} - Items: ${itemsLength}, Max iterations: ${maxIterations}`
      )
    } else {
      maxIterations = loop.iterations || DEFAULT_MAX_ITERATIONS
      logger.info(`For loop ${block.id} - Max iterations: ${maxIterations}`)
    }

    logger.info(
      `Loop ${block.id} - Current iteration: ${currentIteration}, Max iterations: ${maxIterations}`
    )

    // Check if we've reached the maximum iterations
    if (currentIteration >= maxIterations) {
      logger.info(`Loop ${block.id} has reached maximum iterations (${maxIterations})`)

      // Don't mark as completed here - let the loop manager handle it after all blocks execute
      // Just return that this is the final iteration
      return {
        loopId: block.id,
        currentIteration: currentIteration - 1, // Report the actual last iteration number
        maxIterations,
        loopType: loop.loopType || 'for',
        completed: false, // Not completed until all blocks in this iteration execute
        message: `Final iteration ${currentIteration} of ${maxIterations}`,
      } as Record<string, any>
    }

    // For forEach loops, set the current item BEFORE incrementing
    if (loop.loopType === 'forEach' && forEachItems) {
      // Store the full items array for access via <loop.items>
      context.loopItems.set(`${block.id}_items`, forEachItems)

      const currentItem = Array.isArray(forEachItems)
        ? forEachItems[currentIteration]
        : Object.entries(forEachItems)[currentIteration]
      context.loopItems.set(block.id, currentItem)
      logger.info(
        `Loop ${block.id} - Set current item for iteration ${currentIteration}:`,
        currentItem
      )
    }

    // Increment the iteration counter for the NEXT iteration
    // This happens AFTER we've set up the current iteration's data
    context.loopIterations.set(block.id, currentIteration + 1)
    logger.info(
      `Loop ${block.id} - Incremented counter for next iteration: ${currentIteration + 1}`
    )

    // Use routing strategy to determine if this block requires active path checking
    const blockType = block.metadata?.id
    if (Routing.requiresActivePathCheck(blockType || '')) {
      let isInActivePath = true
      if (this.pathTracker) {
        try {
          isInActivePath = this.pathTracker.isInActivePath(block.id, context)
        } catch (error) {
          logger.warn(`PathTracker check failed for ${blockType} block ${block.id}:`, error)
          // Default to true to maintain existing behavior if PathTracker fails
          isInActivePath = true
        }
      }

      // Only activate child nodes if this block is in the active execution path
      if (isInActivePath) {
        this.activateChildNodes(block, context, currentIteration)
      } else {
        logger.info(
          `${blockType} block ${block.id} is not in active execution path, skipping child activation`
        )
      }
    } else {
      // Regular blocks always activate their children
      this.activateChildNodes(block, context, currentIteration)
    }

    return {
      loopId: block.id,
      currentIteration,
      maxIterations,
      loopType: loop.loopType || 'for',
      completed: false,
      message: `Starting iteration ${currentIteration + 1} of ${maxIterations}`,
    } as Record<string, any>
  }

  /**
   * Activate child nodes for loop execution
   */
  private activateChildNodes(
    block: SerializedBlock,
    context: ExecutionContext,
    currentIteration: number
  ): void {
    // Loop is still active, activate the loop-start-source connection
    const loopStartConnections =
      context.workflow?.connections.filter(
        (conn) => conn.source === block.id && conn.sourceHandle === 'loop-start-source'
      ) || []

    for (const conn of loopStartConnections) {
      context.activeExecutionPath.add(conn.target)
      logger.info(`Activated loop start path to ${conn.target} for iteration ${currentIteration}`)
    }
  }

  /**
   * Evaluates forEach items expression or value
   */
  private async evaluateForEachItems(
    forEachItems: any,
    context: ExecutionContext,
    block: SerializedBlock
  ): Promise<any[] | Record<string, any> | null> {
    // If already an array or object, return as-is
    if (
      Array.isArray(forEachItems) ||
      (typeof forEachItems === 'object' && forEachItems !== null)
    ) {
      return forEachItems
    }

    // If it's a string expression, try to evaluate it
    if (typeof forEachItems === 'string') {
      try {
        const trimmed = forEachItems.trim()
        if (trimmed.startsWith('//') || trimmed === '') {
          return []
        }

        // Try to parse as JSON first
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            return JSON.parse(trimmed)
          } catch {
            // Continue to expression evaluation
          }
        }

        // If we have a resolver, use it to resolve any block references in the expression
        if (this.resolver) {
          const resolved = this.resolver.resolveBlockReferences(forEachItems, context, block)

          // Try to parse the resolved value
          try {
            return JSON.parse(resolved)
          } catch {
            // If it's not valid JSON, try to evaluate as an expression
            try {
              const result = new Function(`return ${resolved}`)()
              if (Array.isArray(result) || (typeof result === 'object' && result !== null)) {
                return result
              }
            } catch (e) {
              logger.error(`Error evaluating forEach expression: ${resolved}`, e)
            }
          }
        }

        logger.warn(`forEach expression evaluation not fully implemented: ${forEachItems}`)
        return null
      } catch (error) {
        logger.error(`Error evaluating forEach items:`, error)
        return null
      }
    }

    return null
  }
}
