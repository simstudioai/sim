import { createLogger } from '@/lib/logs/console-logger'
import { getAllBlocks } from '@/blocks'
import { generateRouterPrompt } from '@/blocks/blocks/router'
import { BlockOutput } from '@/blocks/types'
import { executeProviderRequest } from '@/providers'
import { getProviderFromModel } from '@/providers/utils'
import { transformBlockTool } from '@/providers/utils'
import { SerializedBlock } from '@/serializer/types'
import { executeTool, getTool } from '@/tools'
import { PathTracker } from './path'
import { ExecutionContext } from './types'

const logger = createLogger('Handlers')

/**
 * Interface for block handlers that execute specific block types.
 * Each handler is responsible for executing a particular type of block.
 */
export interface BlockHandler {
  /**
   * Determines if this handler can process the given block.
   *
   * @param block - Block to check
   * @returns True if this handler can process the block
   */
  canHandle(block: SerializedBlock): boolean

  /**
   * Executes the block with the given inputs and context.
   *
   * @param block - Block to execute
   * @param inputs - Resolved input parameters
   * @param context - Current execution context
   * @returns Block execution output
   */
  execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput>
}

/**
 * Shared helper for executing code with WebContainer and VM fallback
 * @param code - The code to execute
 * @param params - Parameters to pass to the code
 * @param timeout - Execution timeout in milliseconds
 * @returns Execution result
 */
async function executeCodeWithFallback(
  code: string,
  params: Record<string, any> = {},
  timeout: number = 5000
): Promise<{ success: boolean; output: any; error?: string }> {
  // Only try WebContainer in browser environment with direct execution
  const isBrowser = typeof window !== 'undefined'
  if (isBrowser && window.crossOriginIsolated) {
    try {
      // Dynamically import WebContainer to prevent server-side import
      const { executeCode } = await import('@/lib/webcontainer')

      // Execute directly in the browser
      const result = await executeCode(code, params, timeout)

      if (!result.success) {
        logger.warn(`WebContainer API execution failed: ${result.error}`)
        throw new Error(result.error || `WebContainer execution failed with no error message`)
      }

      return { success: true, output: result.output }
    } catch (error: any) {
      logger.warn('WebContainer execution failed, falling back to VM:', error)
      logger.error('WebContainer error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      })
    }
  }

  // Fall back to VM execution if WebContainer fails or not available
  try {
    const vmResult = await executeTool('function_execute', { code, ...params }, true)

    if (!vmResult.success) {
      throw new Error(vmResult.error || `Function execution failed with no error message`)
    }

    return { success: true, output: vmResult.output }
  } catch (vmError: any) {
    return {
      success: false,
      output: null,
      error: `Function execution failed: ${vmError.message}`,
    }
  }
}

/**
 * Handler for Agent blocks that process LLM requests with optional tools.
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
    logger.info(`Executing agent block: ${block.id}`)

    // Check for null values and try to resolve from environment variables
    const nullInputs = Object.entries(inputs)
      .filter(([_, value]) => value === null)
      .map(([key]) => key)

    // Parse response format if provided
    let responseFormat: any = undefined
    if (inputs.responseFormat) {
      // Handle empty string case - treat it as no response format
      if (inputs.responseFormat === '') {
        responseFormat = undefined
      } else {
        try {
          responseFormat =
            typeof inputs.responseFormat === 'string'
              ? JSON.parse(inputs.responseFormat)
              : inputs.responseFormat

          // Ensure the responseFormat is properly structured
          if (responseFormat && typeof responseFormat === 'object') {
            // If it's just a raw schema without the expected wrapper properties,
            // wrap it properly for the provider
            if (!responseFormat.schema && !responseFormat.name) {
              responseFormat = {
                name: 'response_schema',
                schema: responseFormat,
                strict: true,
              }
            }
          }
        } catch (error: any) {
          logger.error(`Failed to parse response format:`, { error })
          throw new Error(`Invalid response format: ${error.message}`)
        }
      }
    }

    const model = inputs.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)
    logger.info(`Using provider: ${providerId}, model: ${model}`)

    // Format tools for provider API
    const formattedTools = Array.isArray(inputs.tools)
      ? (
          await Promise.all(
            inputs.tools.map(async (tool: any) => {
              // Handle custom tools
              if (tool.type === 'custom-tool' && tool.schema) {
                // Add function execution capability to custom tools with code
                if (tool.code) {
                  // Store the tool's code and make it available for execution
                  const toolName = tool.schema.function.name
                  const params = tool.params || {}

                  // Create a tool that can execute the code
                  return {
                    id: `custom_${tool.title}`,
                    name: toolName,
                    description: tool.schema.function.description || '',
                    params: params,
                    parameters: {
                      type: tool.schema.function.parameters.type,
                      properties: tool.schema.function.parameters.properties,
                      required: tool.schema.function.parameters.required || [],
                    },
                    executeFunction: async (callParams: Record<string, any>) => {
                      try {
                        // Execute the code with WebContainer fallback
                        const result = await executeCodeWithFallback(
                          tool.code,
                          { ...params, ...callParams },
                          tool.timeout || 5000
                        )

                        if (!result.success) {
                          throw new Error(result.error || 'Function execution failed')
                        }

                        return result.output
                      } catch (error: any) {
                        logger.error(`Error executing custom tool ${toolName}:`, error)
                        throw new Error(`Error in ${toolName}: ${error.message}`)
                      }
                    },
                  }
                }

                return {
                  id: `custom_${tool.title}`,
                  name: tool.schema.function.name,
                  description: tool.schema.function.description || '',
                  params: tool.params || {},
                  parameters: {
                    type: tool.schema.function.parameters.type,
                    properties: tool.schema.function.parameters.properties,
                    required: tool.schema.function.parameters.required || [],
                  },
                }
              }

              // Handle regular block tools with operation selection
              return transformBlockTool(tool, {
                selectedOperation: tool.operation,
                getAllBlocks,
                getTool,
              })
            })
          )
        ).filter((t: any): t is NonNullable<typeof t> => t !== null)
      : []

    // Debug request before sending to provider
    const providerRequest = {
      model,
      systemPrompt: inputs.systemPrompt,
      context: Array.isArray(inputs.context)
        ? JSON.stringify(inputs.context, null, 2)
        : typeof inputs.context === 'string'
          ? inputs.context
          : JSON.stringify(inputs.context, null, 2),
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      temperature: inputs.temperature,
      maxTokens: inputs.maxTokens,
      apiKey: inputs.apiKey || context.environmentVariables?.OPENAI_API_KEY,
      responseFormat,
    }

    logger.info(`Provider request prepared`, {
      model: providerRequest.model,
      hasSystemPrompt: !!providerRequest.systemPrompt,
      hasContext: !!providerRequest.context,
      hasTools: !!providerRequest.tools,
      hasApiKey: !!providerRequest.apiKey,
    })

    // Ensure context is properly formatted for the provider
    const response = await executeProviderRequest(providerId, providerRequest)

    logger.info(`Provider response received`, {
      contentLength: response.content ? response.content.length : 0,
      model: response.model,
      hasTokens: !!response.tokens,
      hasToolCalls: !!response.toolCalls,
      toolCallsCount: response.toolCalls?.length || 0,
    })

    // For structured responses, try to parse the content
    if (responseFormat) {
      try {
        const parsedContent = JSON.parse(response.content)

        const result = {
          response: {
            ...parsedContent,
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
          },
        }

        return result
      } catch (error) {
        logger.error(`Failed to parse response content:`, { error })
        logger.info(`Falling back to standard response format`)

        // Fall back to standard response if parsing fails
        return {
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

    // Return standard response if no responseFormat
    return {
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
 * Handler for Router blocks that dynamically select execution paths.
 */
export class RouterBlockHandler implements BlockHandler {
  /**
   * @param pathTracker - Utility for tracking execution paths
   */
  constructor(private pathTracker: PathTracker) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'router'
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

    const response = await executeProviderRequest(providerId, {
      model: routerConfig.model,
      systemPrompt: generateRouterPrompt(routerConfig.prompt, targetBlocks),
      messages: [{ role: 'user', content: routerConfig.prompt }],
      temperature: routerConfig.temperature,
      apiKey: routerConfig.apiKey,
    })

    const chosenBlockId = response.content.trim().toLowerCase()
    const chosenBlock = targetBlocks?.find((b) => b.id === chosenBlockId)

    if (!chosenBlock) {
      throw new Error(`Invalid routing decision: ${chosenBlockId}`)
    }

    const tokens = response.tokens || { prompt: 0, completion: 0, total: 0 }

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
 * Handler for Condition blocks that evaluate expressions to determine execution paths.
 */
export class ConditionBlockHandler implements BlockHandler {
  /**
   * @param pathTracker - Utility for tracking execution paths
   */
  constructor(private pathTracker: PathTracker) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'condition'
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
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

    // Build evaluation context with source block output
    const evalContext = {
      ...(typeof sourceOutput === 'object' && sourceOutput !== null ? sourceOutput : {}),
      [sourceKey]: sourceOutput,
    }

    // Evaluate conditions in order (if, else if, else)
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
        logger.error(`Failed to evaluate condition: ${error.message}`, {
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

  /**
   * Normalizes a block name for consistent lookups.
   *
   * @param name - Block name to normalize
   * @returns Normalized block name (lowercase, no spaces)
   */
  private normalizeBlockName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '')
  }
}

/**
 * Handler for Evaluator blocks that assess content against criteria.
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
    const model = inputs.model || 'gpt-4o'
    const providerId = getProviderFromModel(model)

    // Process the content to ensure it's in a suitable format
    let processedContent = ''

    try {
      if (typeof inputs.content === 'string') {
        if (inputs.content.trim().startsWith('[') || inputs.content.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(inputs.content)
            processedContent = JSON.stringify(parsed, null, 2)
          } catch (e) {
            processedContent = inputs.content
          }
        } else {
          processedContent = inputs.content
        }
      } else if (typeof inputs.content === 'object') {
        processedContent = JSON.stringify(inputs.content, null, 2)
      } else {
        processedContent = String(inputs.content || '')
      }
    } catch (e) {
      logger.error('Error processing content:', e)
      processedContent = String(inputs.content || '')
    }

    // Parse system prompt object with robust error handling
    let systemPromptObj: { systemPrompt: string; responseFormat: any } = {
      systemPrompt: '',
      responseFormat: null,
    }

    const metrics = Array.isArray(inputs.metrics) ? inputs.metrics : []
    const metricDescriptions = metrics
      .map((m: any) => `"${m.name}" (${m.range.min}-${m.range.max}): ${m.description}`)
      .join('\n')

    // Create a response format structure
    const responseProperties: Record<string, any> = {}
    metrics.forEach((m: any) => {
      responseProperties[m.name] = { type: 'number' }
    })

    systemPromptObj = {
      systemPrompt: `You are an evaluation agent. Analyze this content against the metrics and provide scores.
      
    Metrics:
    ${metricDescriptions}

    Content:
    ${processedContent}

    Return a JSON object with each metric name as a key and a numeric score as the value. No explanations, only scores.`,
      responseFormat: {
        name: 'evaluation_response',
        schema: {
          type: 'object',
          properties: responseProperties,
          required: metrics.map((m: any) => m.name),
          additionalProperties: false,
        },
        strict: true,
      },
    }

    // Ensure we have a system prompt
    if (!systemPromptObj.systemPrompt) {
      systemPromptObj.systemPrompt =
        'Evaluate the content and provide scores for each metric as JSON.'
    }

    // Make sure we force JSON output in the request
    const response = await executeProviderRequest(providerId, {
      model: inputs.model,
      systemPrompt: systemPromptObj.systemPrompt,
      responseFormat: systemPromptObj.responseFormat,
      messages: [
        {
          role: 'user',
          content:
            'Please evaluate the content provided in the system prompt. Return ONLY a valid JSON with metric scores.',
        },
      ],
      temperature: inputs.temperature || 0,
      apiKey: inputs.apiKey,
    })

    // Parse response content with robust error handling
    let parsedContent: Record<string, any> = {}
    try {
      const contentStr = response.content.trim()
      let jsonStr = ''

      // Method 1: Extract content between first { and last }
      const fullMatch = contentStr.match(/(\{[\s\S]*\})/)
      if (fullMatch) {
        jsonStr = fullMatch[0]
      }
      // Method 2: Try to find and extract just the JSON part
      else if (contentStr.includes('{') && contentStr.includes('}')) {
        const startIdx = contentStr.indexOf('{')
        const endIdx = contentStr.lastIndexOf('}') + 1
        jsonStr = contentStr.substring(startIdx, endIdx)
      }
      // Method 3: Just use the raw content as a last resort
      else {
        jsonStr = contentStr
      }

      // Try to parse the extracted JSON
      try {
        parsedContent = JSON.parse(jsonStr)
      } catch (parseError) {
        logger.error('Failed to parse extracted JSON:', parseError)
        throw new Error('Invalid JSON in response')
      }
    } catch (error) {
      logger.error('Error parsing evaluator response:', error)
      logger.error('Raw response content:', response.content)

      // Fallback to empty object
      parsedContent = {}
    }

    // Extract and process metric scores with proper validation
    const metricScores: Record<string, any> = {}

    try {
      const metrics = Array.isArray(inputs.metrics) ? inputs.metrics : []

      // If we have a successful parse, extract the metrics
      if (Object.keys(parsedContent).length > 0) {
        metrics.forEach((metric: { name: string }) => {
          const metricName = metric.name
          const lowerCaseMetricName = metricName.toLowerCase()

          // Try multiple possible ways the metric might be represented
          if (parsedContent[metricName] !== undefined) {
            metricScores[lowerCaseMetricName] = Number(parsedContent[metricName])
          } else if (parsedContent[metricName.toLowerCase()] !== undefined) {
            metricScores[lowerCaseMetricName] = Number(parsedContent[metricName.toLowerCase()])
          } else if (parsedContent[metricName.toUpperCase()] !== undefined) {
            metricScores[lowerCaseMetricName] = Number(parsedContent[metricName.toUpperCase()])
          } else {
            // Last resort - try to find any key that might contain this metric name
            const matchingKey = Object.keys(parsedContent).find((key) =>
              key.toLowerCase().includes(metricName.toLowerCase())
            )

            if (matchingKey) {
              metricScores[lowerCaseMetricName] = Number(parsedContent[matchingKey])
            } else {
              logger.warn(`Metric "${metricName}" not found in LLM response`)
              metricScores[lowerCaseMetricName] = 0
            }
          }
        })
      } else {
        // If we couldn't parse any content, set all metrics to 0
        metrics.forEach((metric: { name: string }) => {
          metricScores[metric.name.toLowerCase()] = 0
        })
      }
    } catch (e) {
      logger.error('Error extracting metric scores:', e)
    }

    // Create result with metrics as direct fields for easy access
    const result = {
      response: {
        content: inputs.content,
        model: response.model,
        tokens: {
          prompt: response.tokens?.prompt || 0,
          completion: response.tokens?.completion || 0,
          total: response.tokens?.total || 0,
        },
        ...metricScores,
      },
    }

    return result
  }
}

/**
 * Handler for API blocks that make external HTTP requests.
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
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    const result = await executeTool(block.config.tool, {
      ...inputs,
      _context: { workflowId: context.workflowId },
    })
    if (!result.success) {
      throw new Error(result.error || `API request failed with no error message`)
    }

    return { response: result.output }
  }
}

/**
 * Handler for Function blocks that execute custom code.
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
    // Prepare code for execution
    const codeContent = Array.isArray(inputs.code)
      ? inputs.code.map((c: { content: string }) => c.content).join('\n')
      : inputs.code

    // Use the shared helper function
    const result = await executeCodeWithFallback(
      codeContent,
      {
        ...inputs,
        _context: { workflowId: context.workflowId },
      },
      inputs.timeout || 5000
    )

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    return { response: result.output }
  }
}

/**
 * Generic handler for any block types not covered by specialized handlers.
 * Acts as a fallback for custom or future block types.
 */
export class GenericBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return true
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    const result = await executeTool(block.config.tool, {
      ...inputs,
      _context: { workflowId: context.workflowId },
    })
    if (!result.success) {
      throw new Error(result.error || `Block execution failed with no error message`)
    }

    return { response: result.output }
  }
}
