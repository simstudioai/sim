import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { generateRouterPrompt } from '@/blocks/blocks/router'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import type { PathTracker } from '@/executor/path/path'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { calculateCost, getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('RouterBlockHandler')

/**
 * Handler for Router blocks that dynamically select execution paths.
 */
export class RouterBlockHandler implements BlockHandler {
  /**
   * @param pathTracker - Utility for tracking execution paths
   */
  constructor(private pathTracker: PathTracker) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.ROUTER
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    const targetBlocks = this.getTargetBlocks(block, context)

    const routerConfig = {
      prompt: inputs.prompt,
      model: inputs.model || 'gpt-4o',
      apiKey: inputs.apiKey,
      temperature: inputs.temperature || 0,
    }

    const providerId = getProviderFromModel(routerConfig.model)

    try {
      const baseUrl = env.NEXT_PUBLIC_APP_URL || ''
      const url = new URL('/api/providers', baseUrl)

      // Create the provider request with proper message formatting
      const messages = [{ role: 'user', content: routerConfig.prompt }]
      const systemPrompt = generateRouterPrompt(routerConfig.prompt, targetBlocks)
      const providerRequest = {
        provider: providerId,
        model: routerConfig.model,
        systemPrompt: systemPrompt,
        context: JSON.stringify(messages),
        temperature: routerConfig.temperature,
        apiKey: routerConfig.apiKey,
        workflowId: context.workflowId,
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerRequest),
      })

      if (!response.ok) {
        // Try to extract a helpful error message
        let errorMessage = `Provider API request failed with status ${response.status}`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch (_e) {
          // If JSON parsing fails, use the original error message
        }
        throw new Error(errorMessage)
      }

      const result = await response.json()

      const chosenBlockId = result.content.trim().toLowerCase()
      const chosenBlock = targetBlocks?.find((b) => b.id === chosenBlockId)

      if (!chosenBlock) {
        logger.error(
          `Invalid routing decision. Response content: "${result.content}", available blocks:`,
          targetBlocks?.map((b) => ({ id: b.id, title: b.title })) || []
        )
        throw new Error(`Invalid routing decision: ${chosenBlockId}`)
      }

      const tokens = result.tokens || { prompt: 0, completion: 0, total: 0 }

      // Calculate cost based on token usage, similar to how providers do it
      const cost = calculateCost(
        result.model,
        tokens.prompt || 0,
        tokens.completion || 0,
        false // Router blocks don't typically use cached input
      )

      return {
        content: inputs.prompt,
        model: result.model,
        tokens: {
          prompt: tokens.prompt || 0,
          completion: tokens.completion || 0,
          total: tokens.total || 0,
        },
        cost: {
          input: cost.input,
          output: cost.output,
          total: cost.total,
        },
        selectedPath: {
          blockId: chosenBlock.id,
          blockType: chosenBlock.type || 'unknown',
          blockTitle: chosenBlock.title || 'Untitled Block',
        },
      }
    } catch (error) {
      logger.error('Router execution failed:', error)
      throw error
    }
  }

  /**
   * Gets all potential target blocks for this router.
   *
   * @param block - Router block
   * @param context - Current execution context
   * @returns Array of potential target blocks with metadata
   * @throws Error if target block not found
   */
  private getTargetBlocks(block: SerializedBlock, context: ExecutionContext) {
    return context.workflow?.connections
      .filter((conn) => conn.source === block.id)
      .map((conn) => {
        const targetBlock = context.workflow?.blocks.find((b) => b.id === conn.target)
        if (!targetBlock) {
          throw new Error(`Target block ${conn.target} not found`)
        }

        // Extract system prompt for agent blocks
        let systemPrompt = ''
        if (targetBlock.metadata?.id === BlockType.AGENT) {
          // Try to get system prompt from different possible locations
          systemPrompt =
            targetBlock.config?.params?.systemPrompt || targetBlock.inputs?.systemPrompt || ''

          // If system prompt is still not found, check if we can extract it from inputs
          if (!systemPrompt && targetBlock.inputs) {
            systemPrompt = targetBlock.inputs.systemPrompt || ''
          }
        }

        return {
          id: targetBlock.id,
          type: targetBlock.metadata?.id,
          title: targetBlock.metadata?.name,
          description: targetBlock.metadata?.description,
          subBlocks: {
            ...targetBlock.config.params,
            systemPrompt: systemPrompt,
          },
          currentState: context.blockStates.get(targetBlock.id)?.output,
        }
      })
  }
}
