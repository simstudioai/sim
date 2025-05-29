import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import { getAllBlocks } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { getProviderFromModel, transformBlockTool } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { getTool, getToolAsync } from '@/tools/utils'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '../../types'

const logger = createLogger('AgentBlockHandler')

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
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing agent block: ${block.id}`)

    // Parse response format if provided
    let responseFormat: any
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
          logger.error('Failed to parse response format:', { error })
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
            // First filter out any tools with usageControl set to 'none'
            inputs.tools
              .filter((tool: any) => {
                const usageControl = tool.usageControl || 'auto'
                if (usageControl === 'none') {
                  logger.info(`Filtering out tool set to 'none': ${tool.title || tool.type}`)
                  return false
                }
                return true
              })
              .map(async (tool: any) => {
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
                      usageControl: tool.usageControl || 'auto',
                      executeFunction: async (callParams: Record<string, any>) => {
                        try {
                          // Execute the code using the function_execute tool
                          const result = await executeTool('function_execute', {
                            code: tool.code,
                            ...params,
                            ...callParams,
                            timeout: tool.timeout || 5000,
                          })

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
                    usageControl: tool.usageControl || 'auto',
                  }
                }

                // Handle regular block tools with operation selection
                const transformedTool = await transformBlockTool(tool, {
                  selectedOperation: tool.operation,
                  getAllBlocks,
                  getToolAsync: (toolId: string) => getToolAsync(toolId, context.workflowId),
                  getTool,
                })

                // Add usageControl to the transformed tool if it exists
                if (transformedTool) {
                  transformedTool.usageControl = tool.usageControl || 'auto'
                }

                return transformedTool
              })
          )
        ).filter((t: any): t is NonNullable<typeof t> => t !== null)
      : []

    // Check if streaming is requested and this block is selected for streaming
    const isBlockSelectedForOutput =
      context.selectedOutputIds?.some((outputId) => {
        // First check for direct match (if the entire outputId is the blockId)
        if (outputId === block.id) {
          logger.info(`Direct match found for block ${block.id} in selected outputs`)
          return true
        }

        // Then try parsing the blockId from the blockId_path format
        const firstUnderscoreIndex = outputId.indexOf('_')
        if (firstUnderscoreIndex !== -1) {
          const blockId = outputId.substring(0, firstUnderscoreIndex)
          const isMatch = blockId === block.id
          if (isMatch) {
            logger.info(
              `Path match found for block ${block.id} in selected outputs (from ${outputId})`
            )
          }
          return isMatch
        }
        return false
      }) ?? false

    // Check if this block has any outgoing connections
    const hasOutgoingConnections = context.edges?.some((edge) => edge.source === block.id) ?? false

    // Determine if we should use streaming for this block
    const shouldUseStreaming = context.stream && isBlockSelectedForOutput

    if (shouldUseStreaming) {
      logger.info(
        `Block ${block.id} will use streaming response (selected for output with no outgoing connections)`
      )
    }

    // Initialize parsedMessages - will be built from memories/prompts if provided
    let parsedMessages: any[] | undefined

    // Check if we're in advanced mode with the memories field
    if (inputs.memories || (inputs.systemPrompt && inputs.userPrompt)) {
      const messages: any[] = []

      if (inputs.memories) {
        const memories = inputs.memories

        const memoryMessages = processMemories(memories, logger)
        messages.push(...memoryMessages)
      }

      // Handle system prompt with clear precedence rules
      if (inputs.systemPrompt) {
        // Check for existing system messages in memories
        const systemMessages = messages.filter((msg) => msg.role === 'system')

        if (systemMessages.length > 1) {
          logger.warn(
            `Found ${systemMessages.length} system messages in memories. Explicit systemPrompt will take precedence.`
          )
        } else if (systemMessages.length === 1) {
          logger.info(
            'Found system message in memories. Explicit systemPrompt will take precedence.'
          )
        }

        // Remove any existing system messages and add the explicit one at the beginning
        messages.splice(0, 0, {
          role: 'system',
          content: inputs.systemPrompt,
        })

        // Remove any other system messages that came from memories
        for (let i = messages.length - 1; i >= 1; i--) {
          if (messages[i].role === 'system') {
            messages.splice(i, 1)
          }
        }

        logger.info(
          'Added explicit system prompt as first message, removed any system messages from memories'
        )
      } else {
        // No explicit system prompt provided, check for multiple system messages in memories
        const systemMessages = messages.filter((msg) => msg.role === 'system')

        if (systemMessages.length > 1) {
          logger.warn(
            `Found ${systemMessages.length} system messages in memories with no explicit systemPrompt. Consider providing an explicit systemPrompt for consistent behavior.`
          )
        } else if (systemMessages.length === 1) {
          logger.info('Using system message from memories')
        }
      }

      if (inputs.userPrompt) {
        let userContent = inputs.userPrompt
        if (typeof userContent === 'object' && userContent.input) {
          userContent = userContent.input
        } else if (typeof userContent === 'object') {
          userContent = JSON.stringify(userContent)
        }

        messages.push({
          role: 'user',
          content: userContent,
        })
        logger.info('Added user prompt to messages', { contentType: typeof userContent })
      }

      if (messages.length > 0) {
        parsedMessages = messages
        logger.info('Built messages from advanced mode', {
          messageCount: messages.length,
          firstMessage: messages[0],
          lastMessage: messages[messages.length - 1],
        })
      }
    }

    // Fast validation of parsed messages
    const validMessages =
      Array.isArray(parsedMessages) &&
      parsedMessages.length > 0 &&
      parsedMessages.every(
        (msg) =>
          typeof msg === 'object' &&
          msg !== null &&
          'role' in msg &&
          typeof msg.role === 'string' &&
          ('content' in msg ||
            (msg.role === 'assistant' && ('function_call' in msg || 'tool_calls' in msg)))
      )

    if (Array.isArray(parsedMessages) && parsedMessages.length > 0 && !validMessages) {
      logger.warn('Messages array has invalid format:', {
        messageCount: parsedMessages.length,
      })
    } else if (validMessages) {
      logger.info('Messages validated successfully')
    }

    // Debug request before sending to provider
    const providerRequest = {
      provider: providerId,
      model,
      // If messages are provided (advanced mode), use them exclusively and skip systemPrompt/context
      ...(validMessages
        ? { messages: parsedMessages }
        : {
            systemPrompt: inputs.systemPrompt,
            context: inputs.userPrompt
              ? Array.isArray(inputs.userPrompt)
                ? JSON.stringify(inputs.userPrompt, null, 2)
                : typeof inputs.userPrompt === 'string'
                  ? inputs.userPrompt
                  : JSON.stringify(inputs.userPrompt, null, 2)
              : undefined,
          }),
      tools: formattedTools.length > 0 ? formattedTools : undefined,
      temperature: inputs.temperature,
      maxTokens: inputs.maxTokens,
      apiKey: inputs.apiKey,
      responseFormat,
      workflowId: context.workflowId,
      stream: shouldUseStreaming,
    }

    logger.info('Provider request prepared', {
      model: providerRequest.model,
      hasMessages: Array.isArray(parsedMessages) && parsedMessages.length > 0,
      hasSystemPrompt:
        !(Array.isArray(parsedMessages) && parsedMessages.length > 0) && !!inputs.systemPrompt,
      hasContext:
        !(Array.isArray(parsedMessages) && parsedMessages.length > 0) && !!inputs.userPrompt,
      hasTools: !!providerRequest.tools,
      hasApiKey: !!providerRequest.apiKey,
      workflowId: providerRequest.workflowId,
      stream: shouldUseStreaming,
      isBlockSelectedForOutput,
      hasOutgoingConnections,
      // Debug info about messages to help diagnose issues
      messagesProvided: 'messages' in providerRequest,
      messagesCount:
        'messages' in providerRequest && Array.isArray(providerRequest.messages)
          ? providerRequest.messages.length
          : 0,
    })

    const baseUrl = env.NEXT_PUBLIC_APP_URL || ''
    const url = new URL('/api/providers', baseUrl)

    try {
      logger.info(`Making provider request to: ${url.toString()}`, {
        workflowId: context.workflowId,
        blockId: block.id,
        provider: providerId,
        model,
        timestamp: new Date().toISOString(),
      })

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerRequest),
        // Add timeout and signal for better error handling
        signal: AbortSignal.timeout(120000), // 2 minute timeout
      })

      if (!response.ok) {
        // Try to extract a helpful error message
        let errorMessage = `Provider API request failed with status ${response.status}`
        let errorDetails = null

        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
            errorDetails = errorData
          }
        } catch (_e) {
          // If JSON parsing fails, try to get text response
          try {
            const textError = await response.text()
            if (textError) {
              errorDetails = { textResponse: textError }
            }
          } catch (_textError) {
            // If text parsing also fails, use the original error message
          }
        }

        logger.error('Provider API request failed', {
          workflowId: context.workflowId,
          blockId: block.id,
          status: response.status,
          statusText: response.statusText,
          url: url.toString(),
          errorMessage,
          errorDetails,
          headers: Object.fromEntries(response.headers.entries()),
        })

        throw new Error(errorMessage)
      }

      // Check if we're getting a streaming response
      const contentType = response.headers.get('Content-Type')
      if (contentType?.includes('text/event-stream')) {
        logger.info(`Received streaming response for block ${block.id}`)

        // Ensure we have a valid body stream
        if (!response.body) {
          throw new Error(`No response body in streaming response for block ${block.id}`)
        }

        // Check if we have execution data in the header
        const executionDataHeader = response.headers.get('X-Execution-Data')
        if (executionDataHeader) {
          try {
            // Parse the execution data from the header
            const executionData = JSON.parse(executionDataHeader)

            // Add block-specific data to the execution logs if needed
            if (executionData?.logs) {
              for (const log of executionData.logs) {
                if (!log.blockId) log.blockId = block.id
                if (!log.blockName && block.metadata?.name) log.blockName = block.metadata.name
                if (!log.blockType && block.metadata?.id) log.blockType = block.metadata.id
              }
            }

            // Add block metadata to the execution data if missing
            if (executionData.output?.response) {
              // Ensure model and block info is set
              if (block.metadata?.name && !executionData.blockName) {
                executionData.blockName = block.metadata.name
              }
              if (block.metadata?.id && !executionData.blockType) {
                executionData.blockType = block.metadata.id
              }
              if (!executionData.blockId) {
                executionData.blockId = block.id
              }

              // Add explicit streaming flag to make it easier to identify streaming executions
              executionData.isStreaming = true
            }

            // Return both the stream and the execution data as separate properties
            const streamingExecution: StreamingExecution = {
              stream: response.body,
              execution: executionData,
            }
            return streamingExecution
          } catch (error) {
            logger.error(`Error parsing execution data header: ${error}`)
            // Continue with just the stream if there's an error
          }
        }

        // No execution data in header, just return the stream
        // Create a minimal StreamingExecution with empty execution data
        const minimalExecution: StreamingExecution = {
          stream: response.body,
          execution: {
            success: true,
            output: { response: {} },
            logs: [],
            metadata: {
              duration: 0,
              startTime: new Date().toISOString(),
            },
          },
        }
        return minimalExecution
      }

      // Check if we have a combined response with both stream and execution data
      const result = await response.json()

      if (result && typeof result === 'object' && 'stream' in result && 'execution' in result) {
        logger.info(`Received combined streaming response for block ${block.id}`)

        // Get the stream as a ReadableStream (need to convert from serialized format)
        const stream = new ReadableStream({
          start(controller) {
            // Since stream was serialized as JSON, we need to reconstruct it
            // For now, we'll just use a placeholder message
            const encoder = new TextEncoder()
            controller.enqueue(
              encoder.encode(
                'Stream data cannot be serialized as JSON. You will need to return a proper stream.'
              )
            )
            controller.close()
          },
        })

        // Return both in a format the executor can handle
        const streamingExecution: StreamingExecution = {
          stream,
          execution: result.execution,
        }
        return streamingExecution
      }

      logger.info('Provider response received', {
        contentLength: result.content ? result.content.length : 0,
        model: result.model,
        hasTokens: !!result.tokens,
        hasToolCalls: !!result.toolCalls,
        toolCallsCount: result.toolCalls?.length || 0,
      })

      // If structured responses, try to parse the content
      if (responseFormat) {
        try {
          const parsedContent = JSON.parse(result.content)

          const responseResult = {
            response: {
              ...parsedContent,
              tokens: result.tokens || {
                prompt: 0,
                completion: 0,
                total: 0,
              },
              toolCalls: result.toolCalls
                ? {
                    list: result.toolCalls.map((tc: any) => ({
                      ...tc,
                      // Strip the 'custom_' prefix from tool names for display
                      name: stripCustomToolPrefix(tc.name),
                      // Preserve timing information if available
                      startTime: tc.startTime,
                      endTime: tc.endTime,
                      duration: tc.duration,
                      input: tc.arguments || tc.input,
                      output: tc.result || tc.output,
                    })),
                    count: result.toolCalls.length,
                  }
                : undefined,
              providerTiming: result.timing || undefined,
              cost: result.cost || undefined,
            },
          }

          return responseResult
        } catch (error) {
          logger.error('Failed to parse response content:', { error })
          logger.info('Falling back to standard response format')

          // Fall back to standard response if parsing fails
          return {
            response: {
              content: result.content,
              model: result.model,
              tokens: result.tokens || {
                prompt: 0,
                completion: 0,
                total: 0,
              },
              toolCalls: {
                list: result.toolCalls
                  ? result.toolCalls.map((tc: any) => ({
                      ...tc,
                      // Strip the 'custom_' prefix from tool names for display
                      name: stripCustomToolPrefix(tc.name),
                      // Preserve timing information if available
                      startTime: tc.startTime,
                      endTime: tc.endTime,
                      duration: tc.duration,
                      input: tc.arguments || tc.input,
                      output: tc.result || tc.output,
                    }))
                  : [],
                count: result.toolCalls?.length || 0,
              },
              providerTiming: result.timing || undefined,
              cost: result.cost || undefined,
            },
          }
        }
      }

      // Return standard response if no responseFormat
      return {
        response: {
          content: result.content,
          model: result.model,
          tokens: result.tokens || {
            prompt: 0,
            completion: 0,
            total: 0,
          },
          toolCalls: {
            list: result.toolCalls
              ? result.toolCalls.map((tc: any) => ({
                  ...tc,
                  // Strip the 'custom_' prefix from tool names for display
                  name: stripCustomToolPrefix(tc.name),
                  // Preserve timing information if available
                  startTime: tc.startTime,
                  endTime: tc.endTime,
                  duration: tc.duration,
                  input: tc.arguments || tc.input,
                  output: tc.result || tc.output,
                }))
              : [],
            count: result.toolCalls?.length || 0,
          },
          providerTiming: result.timing || undefined,
          cost: result.cost || undefined,
        },
      }
    } catch (error) {
      logger.error('Error executing provider request:', { error })

      // Enhanced error logging for different error types
      if (error instanceof Error) {
        logger.error('Provider request error details', {
          workflowId: context.workflowId,
          blockId: block.id,
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
          url: url.toString(),
          timestamp: new Date().toISOString(),
        })

        // Check for specific error types
        if (error.name === 'AbortError') {
          logger.error('Request timed out after 2 minutes', {
            workflowId: context.workflowId,
            blockId: block.id,
            url: url.toString(),
          })
          throw new Error('Provider request timed out - the API took too long to respond')
        }
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
          logger.error('Network fetch error - possible connectivity issue', {
            workflowId: context.workflowId,
            blockId: block.id,
            url: url.toString(),
            errorMessage: error.message,
          })
          throw new Error(
            'Network error - unable to connect to provider API. Please check your internet connection.'
          )
        }
        if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
          logger.error('DNS/Connection error', {
            workflowId: context.workflowId,
            blockId: block.id,
            url: url.toString(),
            errorMessage: error.message,
          })
          throw new Error('Unable to connect to server - DNS or connection issue')
        }
      }

      throw error
    }
  }
}

export function stripCustomToolPrefix(name: string) {
  return name.startsWith('custom_') ? name.replace('custom_', '') : name
}

/**
 * Helper function to process memories and convert them to message format
 */
function processMemories(memories: any, logger: any): any[] {
  const messages: any[] = []

  if (!memories) {
    return messages
  }

  let memoryArray: any[] = []

  // Handle different memory input formats
  if (memories?.response?.memories && Array.isArray(memories.response.memories)) {
    // Memory block output format: { response: { memories: [...] } }
    memoryArray = memories.response.memories
  } else if (memories?.memories && Array.isArray(memories.memories)) {
    // Direct memory output format: { memories: [...] }
    memoryArray = memories.memories
  } else if (Array.isArray(memories)) {
    // Direct array of messages: [{ role, content }, ...]
    memoryArray = memories
  } else {
    logger.warn('Unexpected memories format', { memories })
    return messages
  }

  // Process the memory array
  memoryArray.forEach((memory: any) => {
    if (memory.data && Array.isArray(memory.data)) {
      // Memory object with data array: { key, type, data: [{ role, content }, ...] }
      memory.data.forEach((msg: any) => {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role,
            content: msg.content,
          })
        }
      })
    } else if (memory.role && memory.content) {
      // Direct message object: { role, content }
      messages.push({
        role: memory.role,
        content: memory.content,
      })
    }
  })

  return messages
}
