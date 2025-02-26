import { getAllBlocks } from '@/blocks'
import { generateRouterPrompt } from '@/blocks/blocks/router'
import { BlockOutput } from '@/blocks/types'
import { executeProviderRequest } from '@/providers/service'
import { getProviderFromModel } from '@/providers/utils'
import { SerializedBlock } from '@/serializer/types'
import { executeTool, getTool } from '@/tools'
import { PathTracker } from './path'
import { ExecutionContext } from './types'

/**
 * Interface for block handlers that execute specific block types
 */
export interface BlockHandler {
  canHandle(block: SerializedBlock): boolean
  execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput>
}

/**
 * Handler for Agent blocks
 */
export class AgentBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'agent'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Parse response format if provided
    let responseFormat: any = undefined
    if (inputs.responseFormat) {
      try {
        responseFormat =
          typeof inputs.responseFormat === 'string'
            ? JSON.parse(inputs.responseFormat)
            : inputs.responseFormat
      } catch (error: any) {
        throw new Error(`Invalid response format: ${error.message}`)
      }
    }

    // Get model and provider
    const model = inputs.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)

    // Format tools if provided
    const formattedTools = Array.isArray(inputs.tools)
      ? inputs.tools
          .map((tool: any) => {
            const blockFound = getAllBlocks().find((b) => b.type === tool.type)
            const toolId = blockFound?.tools.access[0]
            if (!toolId) return null

            const toolConfig = getTool(toolId)
            if (!toolConfig) return null

            return {
              id: toolConfig.id,
              name: toolConfig.name,
              description: toolConfig.description,
              params: tool.params || {},
              parameters: {
                type: 'object',
                properties: Object.entries(toolConfig.params).reduce(
                  (acc, [key, config]) => ({
                    ...acc,
                    [key]: {
                      type: config.type === 'json' ? 'object' : config.type,
                      description: config.description || '',
                      ...(key in tool.params && { default: tool.params[key] }),
                    },
                  }),
                  {}
                ),
                required: Object.entries(toolConfig.params)
                  .filter(([_, config]) => config.required)
                  .map(([key]) => key),
              },
            }
          })
          .filter((t): t is NonNullable<typeof t> => t !== null)
      : []

    // Execute provider request
    const response = await executeProviderRequest(providerId, {
      model,
      systemPrompt: inputs.systemPrompt,
      context: Array.isArray(inputs.context)
        ? JSON.stringify(inputs.context, null, 2)
        : inputs.context,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      temperature: inputs.temperature,
      maxTokens: inputs.maxTokens,
      apiKey: inputs.apiKey,
      responseFormat,
    })

    // Format output based on response format
    return responseFormat
      ? {
          ...JSON.parse(response.content),
          tokens: response.tokens || {
            prompt: 0,
            completion: 0,
            total: 0,
          },
          toolCalls: response.toolCalls
            ? {
                list: response.toolCalls,
                count: response.toolCalls.length,
              }
            : undefined,
        }
      : {
          response: {
            content: response.content,
            model: response.model,
            tokens: response.tokens || {
              prompt: 0,
              completion: 0,
              total: 0,
            },
            toolCalls: {
              list: response.toolCalls || [],
              count: response.toolCalls?.length || 0,
            },
          },
        }
  }
}

/**
 * Handler for Router blocks
 */
export class RouterBlockHandler implements BlockHandler {
  constructor(private pathTracker: PathTracker) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'router'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Get potential targets for the router
    const targetBlocks = this.getTargetBlocks(block, context)

    // Router configuration
    const routerConfig = {
      prompt: inputs.prompt,
      model: inputs.model || 'gpt-4o',
      apiKey: inputs.apiKey,
      temperature: inputs.temperature || 0,
    }

    // Get provider
    const providerId = getProviderFromModel(routerConfig.model)

    // Generate and execute router prompt
    const response = await executeProviderRequest(providerId, {
      model: routerConfig.model,
      systemPrompt: generateRouterPrompt(routerConfig.prompt, targetBlocks),
      messages: [{ role: 'user', content: routerConfig.prompt }],
      temperature: routerConfig.temperature,
      apiKey: routerConfig.apiKey,
    })

    // Process the response to get the chosen block ID
    const chosenBlockId = response.content.trim().toLowerCase()
    const chosenBlock = targetBlocks?.find((b) => b.id === chosenBlockId)

    if (!chosenBlock) {
      throw new Error(`Invalid routing decision: ${chosenBlockId}`)
    }

    // Format tokens information
    const tokens = response.tokens || { prompt: 0, completion: 0, total: 0 }

    // Return formatted output
    return {
      response: {
        content: inputs.prompt,
        model: response.model,
        tokens: {
          prompt: tokens.prompt || 0,
          completion: tokens.completion || 0,
          total: tokens.total || 0,
        },
        selectedPath: {
          blockId: chosenBlock.id,
          blockType: chosenBlock.type || 'unknown',
          blockTitle: chosenBlock.title || 'Untitled Block',
        },
      },
    }
  }

  private getTargetBlocks(block: SerializedBlock, context: ExecutionContext) {
    // Find blocks connected to this router
    return context.workflow?.connections
      .filter((conn) => conn.source === block.id)
      .map((conn) => {
        const targetBlock = context.workflow?.blocks.find((b) => b.id === conn.target)
        if (!targetBlock) {
          throw new Error(`Target block ${conn.target} not found`)
        }
        return {
          id: targetBlock.id,
          type: targetBlock.metadata?.id,
          title: targetBlock.metadata?.name,
          description: targetBlock.metadata?.description,
          subBlocks: targetBlock.config.params,
          currentState: context.blockStates.get(targetBlock.id)?.output,
        }
      })
  }
}

/**
 * Handler for Condition blocks
 */
export class ConditionBlockHandler implements BlockHandler {
  constructor(private pathTracker: PathTracker) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'condition'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Parse conditions
    const conditions = Array.isArray(inputs.conditions)
      ? inputs.conditions
      : JSON.parse(inputs.conditions || '[]')

    // Find source block for the condition
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

    // Get source block to derive a dynamic key
    const sourceBlock = context.workflow?.blocks.find((b) => b.id === sourceBlockId)
    if (!sourceBlock) {
      throw new Error(`Source block ${sourceBlockId} not found`)
    }

    const sourceKey = sourceBlock.metadata?.name
      ? this.normalizeBlockName(sourceBlock.metadata.name)
      : 'source'

    // Get outgoing connections
    const outgoingConnections = context.workflow?.connections.filter(
      (conn) => conn.source === block.id
    )

    // Build evaluation context
    const evalContext = {
      ...(typeof sourceOutput === 'object' && sourceOutput !== null ? sourceOutput : {}),
      [sourceKey]: sourceOutput,
    }

    // Evaluate conditions
    let selectedConnection: { target: string; sourceHandle?: string } | null = null
    let selectedCondition: { id: string; title: string; value: string } | null = null

    for (const condition of conditions) {
      try {
        // Evaluate the condition based on the resolved condition string
        const conditionMet = new Function('context', `with(context) { return ${condition.value} }`)(
          evalContext
        )

        // Find connection for this condition
        const connection = outgoingConnections?.find(
          (conn) => conn.sourceHandle === `condition-${condition.id}`
        ) as { target: string; sourceHandle?: string } | undefined

        if (connection) {
          // For if/else-if, require conditionMet to be true
          // For else, always select it
          if ((condition.title === 'if' || condition.title === 'else if') && conditionMet) {
            selectedConnection = connection
            selectedCondition = condition
            break
          } else if (condition.title === 'else') {
            selectedConnection = connection
            selectedCondition = condition
            break
          }
        }
      } catch (error: any) {
        console.error(`Failed to evaluate condition: ${error.message}`, {
          condition,
          error,
        })
        throw new Error(`Failed to evaluate condition: ${error.message}`)
      }
    }

    if (!selectedConnection || !selectedCondition) {
      throw new Error(`No matching path found for condition block ${block.id}`)
    }

    // Find target block
    const targetBlock = context.workflow?.blocks.find((b) => b.id === selectedConnection!.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection!.target} not found`)
    }

    // Return properly formatted output
    return {
      response: {
        ...((sourceOutput as any)?.response || {}),
        conditionResult: true,
        selectedPath: {
          blockId: targetBlock.id,
          blockType: targetBlock.metadata?.id || '',
          blockTitle: targetBlock.metadata?.name || '',
        },
        selectedConditionId: selectedCondition.id,
      },
    }
  }

  private normalizeBlockName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '')
  }
}

/**
 * Handler for Evaluator blocks
 */
export class EvaluatorBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'evaluator'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Get model and provider
    const model = inputs.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)

    // Parse system prompt object
    const systemPromptObj =
      typeof inputs.systemPrompt === 'string'
        ? JSON.parse(inputs.systemPrompt)
        : inputs.systemPrompt

    // Execute the evaluator prompt with structured output format
    const response = await executeProviderRequest(providerId, {
      model: inputs.model,
      systemPrompt: systemPromptObj?.systemPrompt,
      responseFormat: systemPromptObj?.responseFormat,
      messages: [{ role: 'user', content: inputs.content }],
      temperature: inputs.temperature || 0,
      apiKey: inputs.apiKey,
    })

    // Parse response content
    const parsedContent = JSON.parse(response.content)

    // Create result in expected format
    return {
      response: {
        content: inputs.content,
        model: response.model,
        tokens: {
          prompt: response.tokens?.prompt || 0,
          completion: response.tokens?.completion || 0,
          total: response.tokens?.total || 0,
        },
        // Add each metric as a direct field for easy access
        ...Object.fromEntries(
          Object.entries(parsedContent).map(([key, value]) => [key.toLowerCase(), value])
        ),
      },
    }
  }
}

/**
 * Handler for API blocks
 */
export class ApiBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'api'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Get the tool for this block
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    // Execute the tool
    const result = await executeTool(block.config.tool, inputs)
    if (!result.success) {
      throw new Error(result.error || `API request failed with no error message`)
    }

    return { response: result.output }
  }
}

/**
 * Handler for Function blocks
 */
export class FunctionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'function'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Get the tool for this block
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    // Execute the tool
    const result = await executeTool(block.config.tool, inputs)
    if (!result.success) {
      throw new Error(result.error || `Function execution failed with no error message`)
    }

    return { response: result.output }
  }
}

/**
 * Generic handler for any other block types
 */
export class GenericBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    // This is a fallback handler that can handle any block type
    return true
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    // Get the tool for this block
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    // Execute the tool
    const result = await executeTool(block.config.tool, inputs)
    if (!result.success) {
      throw new Error(result.error || `Block execution failed with no error message`)
    }

    return { response: result.output }
  }
}
