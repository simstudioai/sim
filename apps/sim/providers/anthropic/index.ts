import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@/lib/logs/console-logger'
import type { StreamingExecution } from '@/executor/types'
import { executeTool } from '@/tools'
import { getProviderDefaultModel, getProviderModels } from '../models'
import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'
import { prepareToolsWithUsageControl, trackForcedToolUsage } from '../utils'

const logger = createLogger('AnthropicProvider')

/**
 * Helper to wrap Anthropic streaming (async iterable of SSE events) into a browser-friendly
 * ReadableStream of raw assistant text chunks. We enqueue only `content_block_delta` events
 * with `delta.type === 'text_delta'`, since that contains the incremental text tokens.
 */
function createReadableStreamFromAnthropicStream(
  anthropicStream: AsyncIterable<any>
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta?.text) {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

export const anthropicProvider: ProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  description: "Anthropic's Claude models",
  version: '1.0.0',
  models: getProviderModels('anthropic'),
  defaultModel: getProviderDefaultModel('anthropic'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Anthropic')
    }

    const anthropic = new Anthropic({ apiKey: request.apiKey })

    // Helper function to generate a simple unique ID for tool uses
    const generateToolUseId = (toolName: string) => {
      return `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    }

    // Transform messages to Anthropic format
    const messages = []

    // Add system prompt if present
    let systemPrompt = request.systemPrompt || ''

    // Add context if present
    if (request.context) {
      messages.push({
        role: 'user',
        content: request.context,
      })
    }

    // Add remaining messages
    if (request.messages) {
      request.messages.forEach((msg) => {
        if (msg.role === 'function') {
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.name,
                content: msg.content,
              },
            ],
          })
        } else if (msg.function_call) {
          const toolUseId = `${msg.function_call.name}-${Date.now()}`
          messages.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: toolUseId,
                name: msg.function_call.name,
                input: JSON.parse(msg.function_call.arguments),
              },
            ],
          })
        } else {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content ? [{ type: 'text', text: msg.content }] : [],
          })
        }
      })
    }

    // Ensure there's at least one message
    if (messages.length === 0) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: systemPrompt || 'Hello' }],
      })
      // Clear system prompt since we've used it as a user message
      systemPrompt = ''
    }

    // Transform tools to Anthropic format if provided
    let anthropicTools = request.tools?.length
      ? request.tools.map((tool) => ({
          name: tool.id,
          description: tool.description,
          input_schema: {
            type: 'object',
            properties: tool.parameters.properties,
            required: tool.parameters.required,
          },
        }))
      : undefined

    // Set tool_choice based on usage control settings
    let toolChoice: 'none' | 'auto' | { type: 'tool'; name: string } = 'auto'

    // Handle tools and tool usage control
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (anthropicTools?.length) {
      try {
        preparedTools = prepareToolsWithUsageControl(
          anthropicTools,
          request.tools,
          logger,
          'anthropic'
        )
        const { tools: filteredTools, toolChoice: tc } = preparedTools

        if (filteredTools?.length) {
          anthropicTools = filteredTools

          // No longer need conversion since provider-specific formatting is in prepareToolsWithUsageControl
          if (typeof tc === 'object' && tc !== null) {
            if (tc.type === 'tool') {
              toolChoice = tc
              logger.info(`Using Anthropic tool_choice format: force tool "${tc.name}"`)
            } else {
              // Default to auto if we got a non-Anthropic object format
              toolChoice = 'auto'
              logger.warn('Received non-Anthropic tool_choice format, defaulting to auto')
            }
          } else if (tc === 'auto' || tc === 'none') {
            toolChoice = tc
            logger.info(`Using tool_choice mode: ${tc}`)
          } else {
            // Default to auto if we got something unexpected
            toolChoice = 'auto'
            logger.warn('Unexpected tool_choice format, defaulting to auto')
          }
        }
      } catch (error) {
        logger.error('Error in prepareToolsWithUsageControl:', { error })
        // Continue with default settings
        toolChoice = 'auto'
      }
    }

    // If response format is specified, add strict formatting instructions
    if (request.responseFormat) {
      // Get the schema from the response format
      const schema = request.responseFormat.schema || request.responseFormat

      // Build a system prompt for structured output based on the JSON schema
      let schemaInstructions = ''

      if (schema?.properties) {
        // Create a template of the expected JSON structure
        const jsonTemplate = Object.entries(schema.properties).reduce(
          (acc: Record<string, any>, [key, prop]: [string, any]) => {
            let exampleValue
            const propType = prop.type || 'string'

            // Generate appropriate example values based on type
            switch (propType) {
              case 'string':
                exampleValue = '"value"'
                break
              case 'number':
                exampleValue = '0'
                break
              case 'boolean':
                exampleValue = 'true'
                break
              case 'array':
                exampleValue = '[]'
                break
              case 'object':
                exampleValue = '{}'
                break
              default:
                exampleValue = '"value"'
            }

            acc[key] = exampleValue
            return acc
          },
          {}
        )

        // Generate field descriptions
        const fieldDescriptions = Object.entries(schema.properties)
          .map(([key, prop]: [string, any]) => {
            const type = prop.type || 'string'
            const description = prop.description ? `: ${prop.description}` : ''
            return `${key} (${type})${description}`
          })
          .join('\n')

        // Format the JSON template as a string
        const jsonTemplateStr = JSON.stringify(jsonTemplate, null, 2)

        schemaInstructions = `
IMPORTANT RESPONSE FORMAT INSTRUCTIONS:
1. Your response must be EXACTLY in this format, with no additional fields:
${jsonTemplateStr}

Field descriptions:
${fieldDescriptions}

2. DO NOT include any explanatory text before or after the JSON
3. DO NOT wrap the response in an array
4. DO NOT add any fields not specified in the schema
5. Your response MUST be valid JSON and include all the specified fields with their correct types`
      }

      systemPrompt = `${systemPrompt}${schemaInstructions}`
    }

    // Build the request payload
    const payload: any = {
      model: request.model || 'claude-3-7-sonnet-20250219',
      messages,
      system: systemPrompt,
      max_tokens: Number.parseInt(String(request.maxTokens)) || 1024,
      temperature: Number.parseFloat(String(request.temperature ?? 0.7)),
    }

    // Use the tools in the payload
    if (anthropicTools?.length) {
      payload.tools = anthropicTools
      // Only set tool_choice if it's not 'auto'
      if (toolChoice !== 'auto') {
        payload.tool_choice = toolChoice
      }
    }

    // Check if we should stream tool calls (default: false for chat, true for copilot)
    const shouldStreamToolCalls = request.streamToolCalls ?? false

    // EARLY STREAMING: if caller requested streaming and there are no tools to execute,
    // we can directly stream the completion.
    if (request.stream && (!anthropicTools || anthropicTools.length === 0)) {
      logger.info('Using streaming response for Anthropic request (no tools)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      // Create a streaming request
      const streamResponse: any = await anthropic.messages.create({
        ...payload,
        stream: true,
      })

      // Start collecting token usage
      const tokenUsage = {
        prompt: 0,
        completion: 0,
        total: 0,
      }

      // Create a StreamingExecution response with a readable stream
      const streamingResult = {
        stream: createReadableStreamFromAnthropicStream(streamResponse),
        execution: {
          success: true,
          output: {
            content: '', // Will be filled by streaming content in chat component
            model: request.model,
            tokens: tokenUsage,
            toolCalls: undefined,
            providerTiming: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
              timeSegments: [
                {
                  type: 'model',
                  name: 'Streaming response',
                  startTime: providerStartTime,
                  endTime: Date.now(),
                  duration: Date.now() - providerStartTime,
                },
              ],
            },
            // Estimate token cost based on typical Claude pricing
            cost: {
              total: 0.0,
              input: 0.0,
              output: 0.0,
            },
          },
          logs: [], // No block logs for direct streaming
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
          },
          isStreaming: true,
        },
      }

      // Return the streaming execution object
      return streamingResult as StreamingExecution
    }

    // STREAMING WITH INCREMENTAL PARSING: Handle both text and tool calls in real-time
    if (request.stream && shouldStreamToolCalls) {
      logger.info('Using incremental streaming parser for Anthropic request', {
        hasTools: !!(anthropicTools && anthropicTools.length > 0),
      })

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      // Create a streaming request
      const streamResponse: any = await anthropic.messages.create({
        ...payload,
        stream: true,
      })

      // State for incremental parsing
      let currentBlockType: 'text' | 'tool_use' | null = null
      let toolCallBuffer: any = null
      const toolCalls: any[] = []
      let streamedContent = ''

      // Token usage tracking
      const tokenUsage = {
        prompt: 0,
        completion: 0,
        total: 0,
      }

      // Create an incremental parsing stream
      const incrementalParsingStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResponse) {
              // Handle different chunk types
              if (chunk.type === 'content_block_start') {
                currentBlockType = chunk.content_block?.type

                if (currentBlockType === 'tool_use') {
                  // Start buffering a tool call
                  toolCallBuffer = {
                    id: chunk.content_block.id,
                    name: chunk.content_block.name,
                    input: {},
                  }
                  logger.info(`Starting tool call: ${chunk.content_block.name}`)

                  // Emit tool call detection event
                  const toolDetectionEvent = {
                    type: 'tool_call_detected',
                    toolCall: {
                      id: chunk.content_block.id,
                      name: chunk.content_block.name,
                      displayName: getToolDisplayName(chunk.content_block.name),
                      state: 'detecting',
                    },
                  }
                  controller.enqueue(
                    new TextEncoder().encode(
                      `\n__TOOL_CALL_EVENT__${JSON.stringify(toolDetectionEvent)}__TOOL_CALL_EVENT__\n`
                    )
                  )
                }
              } else if (chunk.type === 'content_block_delta') {
                if (currentBlockType === 'text' && chunk.delta?.text) {
                  // Stream text content immediately to user
                  const textContent = chunk.delta.text
                  streamedContent += textContent
                  controller.enqueue(new TextEncoder().encode(textContent))
                } else if (currentBlockType === 'tool_use' && chunk.delta?.partial_json) {
                  // Buffer tool call parameters
                  if (toolCallBuffer) {
                    try {
                      // Attempt to parse the accumulated JSON
                      const partialInput = chunk.delta.partial_json
                      // This is partial JSON, we'll parse it when the block is complete
                      toolCallBuffer.partialInput =
                        (toolCallBuffer.partialInput || '') + partialInput
                    } catch (error) {
                      // Ignore parsing errors for partial JSON
                    }
                  }
                }
              } else if (chunk.type === 'content_block_stop') {
                if (currentBlockType === 'tool_use' && toolCallBuffer) {
                  try {
                    // Parse the complete tool call input
                    toolCallBuffer.input = JSON.parse(toolCallBuffer.partialInput || '{}')
                    toolCalls.push(toolCallBuffer)

                    // Queue tool call for execution
                    pendingToolCalls.push(toolCallBuffer)

                    logger.info(`Completed tool call buffer for: ${toolCallBuffer.name}`)
                  } catch (error) {
                    logger.error('Error parsing tool call input:', { error, toolCallBuffer })
                  }
                  toolCallBuffer = null
                }
                currentBlockType = null
              } else if (chunk.type === 'message_start') {
                // Track usage data if available
                if (chunk.message?.usage) {
                  tokenUsage.prompt = chunk.message.usage.input_tokens || 0
                }
              } else if (chunk.type === 'message_delta') {
                // Update token counts as they become available
                if (chunk.usage) {
                  tokenUsage.completion = chunk.usage.output_tokens || 0
                  tokenUsage.total = tokenUsage.prompt + tokenUsage.completion
                }
              } else if (chunk.type === 'message_stop') {
                // Stream is complete - execute any pending tool calls
                logger.info('Initial stream completed', {
                  streamedContentLength: streamedContent.length,
                  toolCallsCount: toolCalls.length,
                  pendingToolCallsCount: pendingToolCalls.length,
                })

                if (pendingToolCalls.length > 0) {
                  // Send structured tool call indicators instead of text
                  const toolCallEvent = {
                    type: 'tool_calls_start',
                    toolCalls: pendingToolCalls.map((tc) => ({
                      id: tc.id,
                      name: tc.name,
                      displayName: getToolDisplayName(tc.name),
                      parameters: tc.input,
                      state: 'executing',
                    })),
                  }
                  controller.enqueue(
                    new TextEncoder().encode(
                      `\n__TOOL_CALL_EVENT__${JSON.stringify(toolCallEvent)}__TOOL_CALL_EVENT__\n`
                    )
                  )

                  // Execute tools and continue conversation
                  await executeToolsAndContinue(pendingToolCalls, controller)
                }

                controller.close()
                break
              }
            }
          } catch (error) {
            logger.error('Error in incremental streaming:', { error })
            controller.error(error)
          }
        },
      })

      // Track conversation state for multi-turn tool execution
      const conversationMessages = [...messages]
      const pendingToolCalls: any[] = []
      const completedToolCalls: any[] = []

      // Tool ID to readable name mapping for better UX
      const toolDisplayNames: Record<string, string> = {
        // Actual copilot tool IDs
        docs_search_internal: 'Searching documentation',
        get_user_workflow: 'Analyzing your workflow',
        get_blocks_and_tools: 'Getting context',
        get_blocks_metadata: 'Getting context',
        get_yaml_structure: 'Designing an approach',
        edit_workflow: 'Building your workflow',
      }

      // Helper function to get display name for tool
      const getToolDisplayName = (toolId: string): string => {
        return toolDisplayNames[toolId] || `Executing ${toolId}`
      }

      // Helper function to group tools by their display names
      const groupToolsByDisplayName = (toolCalls: any[]): string[] => {
        const displayNameSet = new Set<string>()
        toolCalls.forEach((tc) => {
          displayNameSet.add(getToolDisplayName(tc.name))
        })
        return Array.from(displayNameSet)
      }

      // Helper function to execute tools and continue conversation
      const executeToolsAndContinue = async (
        toolCalls: any[],
        controller: ReadableStreamDefaultController
      ) => {
        try {
          logger.info(`Executing ${toolCalls.length} tool calls`, {
            toolNames: toolCalls.map((tc) => tc.name),
          })

          // Execute all tools in parallel
          const toolResults = await Promise.all(
            toolCalls.map(async (toolCall) => {
              const tool = request.tools?.find((t: any) => t.id === toolCall.name)
              if (!tool) {
                logger.warn(`Tool not found: ${toolCall.name}`)
                return null
              }

              const toolCallStartTime = Date.now()
              const mergedArgs = {
                ...tool.params,
                ...toolCall.input,
                ...(request.workflowId
                  ? {
                      _context: {
                        workflowId: request.workflowId,
                        ...(request.chatId ? { chatId: request.chatId } : {}),
                      },
                    }
                  : {}),
                ...(request.environmentVariables ? { envVars: request.environmentVariables } : {}),
              }

              const result = await executeTool(toolCall.name, mergedArgs, true)
              const toolCallEndTime = Date.now()

              if (result.success) {
                completedToolCalls.push({
                  name: toolCall.name,
                  arguments: toolCall.input,
                  startTime: new Date(toolCallStartTime).toISOString(),
                  endTime: new Date(toolCallEndTime).toISOString(),
                  duration: toolCallEndTime - toolCallStartTime,
                  result: result.output,
                })
              }

              // Emit tool completion event
              const toolCompletionEvent = {
                type: 'tool_call_complete',
                toolCall: {
                  id: toolCall.id,
                  name: toolCall.name,
                  displayName: getToolDisplayName(toolCall.name),
                  parameters: toolCall.input,
                  state: result.success ? 'completed' : 'error',
                  startTime: toolCallStartTime,
                  endTime: toolCallEndTime,
                  duration: toolCallEndTime - toolCallStartTime,
                  result: result.success ? result.output : null,
                  error: result.success ? null : 'Tool execution failed',
                },
              }
              controller.enqueue(
                new TextEncoder().encode(
                  `\n__TOOL_CALL_EVENT__${JSON.stringify(toolCompletionEvent)}__TOOL_CALL_EVENT__\n`
                )
              )

              return {
                toolCall,
                result: result.success ? result.output : null,
                success: result.success,
              }
            })
          )

          // Add tool calls and results to conversation
          conversationMessages.push({
            role: 'assistant',
            content: toolCalls.map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })) as any,
          })

          conversationMessages.push({
            role: 'user',
            content: toolResults
              .filter((tr) => tr?.success)
              .map((tr) => ({
                type: 'tool_result',
                tool_use_id: tr!.toolCall.id,
                content: JSON.stringify(tr!.result),
              })) as any,
          })

          // Add subtle completion indicator before continuing
          const completionMessage = `\n`
          controller.enqueue(new TextEncoder().encode(completionMessage))

          // Continue the conversation with tool results
          const nextStreamResponse = await anthropic.messages.create({
            ...payload,
            messages: conversationMessages,
            stream: true,
          })

          // Parse the continuation stream
          await parseContinuationStream(nextStreamResponse, controller)
        } catch (error) {
          logger.error('Error executing tools and continuing conversation:', { error })
          // Continue streaming even if tools fail
        }
      }

      // Helper function to parse continuation streams (for tool result responses)
      const parseContinuationStream = async (
        streamResponse: any,
        controller: ReadableStreamDefaultController
      ) => {
        let currentBlockType: 'text' | 'tool_use' | null = null
        let toolCallBuffer: any = null
        const newToolCalls: any[] = []

        for await (const chunk of streamResponse) {
          if (chunk.type === 'content_block_start') {
            currentBlockType = chunk.content_block?.type

            if (currentBlockType === 'tool_use') {
              toolCallBuffer = {
                id: chunk.content_block.id,
                name: chunk.content_block.name,
                input: {},
              }
            }
          } else if (chunk.type === 'content_block_delta') {
            if (currentBlockType === 'text' && chunk.delta?.text) {
              // Stream continuation text immediately
              const textContent = chunk.delta.text
              controller.enqueue(new TextEncoder().encode(textContent))
            } else if (currentBlockType === 'tool_use' && chunk.delta?.partial_json) {
              if (toolCallBuffer) {
                toolCallBuffer.partialInput =
                  (toolCallBuffer.partialInput || '') + chunk.delta.partial_json
              }
            }
          } else if (chunk.type === 'content_block_stop') {
            if (currentBlockType === 'tool_use' && toolCallBuffer) {
              try {
                toolCallBuffer.input = JSON.parse(toolCallBuffer.partialInput || '{}')
                newToolCalls.push(toolCallBuffer)
              } catch (error) {
                logger.error('Error parsing continuation tool call:', { error })
              }
              toolCallBuffer = null
            }
            currentBlockType = null
          } else if (chunk.type === 'message_stop') {
            // If there are more tool calls, emit structured events and execute them
            if (newToolCalls.length > 0) {
              // Send structured tool call indicators for subsequent calls
              const toolCallEvent = {
                type: 'tool_calls_start',
                toolCalls: newToolCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  displayName: getToolDisplayName(tc.name),
                  parameters: tc.input,
                  state: 'executing',
                })),
              }
              controller.enqueue(
                new TextEncoder().encode(
                  `\n__TOOL_CALL_EVENT__${JSON.stringify(toolCallEvent)}__TOOL_CALL_EVENT__\n`
                )
              )

              await executeToolsAndContinue(newToolCalls, controller)
            }
            break
          }
        }
      }

      // Create the streaming result
      const streamingResult = {
        stream: incrementalParsingStream,
        execution: {
          success: true,
          output: {
            content: '', // Will be filled by streaming content
            model: request.model,
            tokens: tokenUsage,
            toolCalls:
              toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
            providerTiming: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
              timeSegments: [
                {
                  type: 'model',
                  name: 'Incremental streaming with tools',
                  startTime: providerStartTime,
                  endTime: Date.now(),
                  duration: Date.now() - providerStartTime,
                },
              ],
            },
            cost: {
              total: 0.0, // Will be updated as tokens are counted
              input: 0.0,
              output: 0.0,
            },
          },
          logs: [],
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
          },
          isStreaming: true,
        },
      }

      // Return the streaming execution object
      return streamingResult as StreamingExecution
    }

    // NON-STREAMING WITH FINAL RESPONSE: Execute all tools silently and return only final response
    if (request.stream && !shouldStreamToolCalls) {
      logger.info('Using non-streaming mode for Anthropic request (tool calls executed silently)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      try {
        // Make the initial API request
        const initialCallTime = Date.now()

        // Track the original tool_choice for forced tool tracking
        const originalToolChoice = payload.tool_choice

        // Track forced tools and their usage
        const forcedTools = preparedTools?.forcedTools || []
        let usedForcedTools: string[] = []

        let currentResponse = await anthropic.messages.create(payload)
        const firstResponseTime = Date.now() - initialCallTime

        let content = ''

        // Extract text content from the message
        if (Array.isArray(currentResponse.content)) {
          content = currentResponse.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('\n')
        }

        const tokens = {
          prompt: currentResponse.usage?.input_tokens || 0,
          completion: currentResponse.usage?.output_tokens || 0,
          total:
            (currentResponse.usage?.input_tokens || 0) +
            (currentResponse.usage?.output_tokens || 0),
        }

        const toolCalls = []
        const toolResults = []
        const currentMessages = [...messages]
        let iterationCount = 0
        const MAX_ITERATIONS = 10 // Prevent infinite loops

        // Track if a forced tool has been used
        let hasUsedForcedTool = false

        // Track time spent in model vs tools
        let modelTime = firstResponseTime
        let toolsTime = 0

        // Track each model and tool call segment with timestamps
        const timeSegments: TimeSegment[] = [
          {
            type: 'model',
            name: 'Initial response',
            startTime: initialCallTime,
            endTime: initialCallTime + firstResponseTime,
            duration: firstResponseTime,
          },
        ]

        // Helper function to check for forced tool usage in Anthropic responses
        const checkForForcedToolUsage = (response: any, toolChoice: any) => {
          if (
            typeof toolChoice === 'object' &&
            toolChoice !== null &&
            Array.isArray(response.content)
          ) {
            const toolUses = response.content.filter((item: any) => item.type === 'tool_use')

            if (toolUses.length > 0) {
              // Convert Anthropic tool_use format to a format trackForcedToolUsage can understand
              const adaptedToolCalls = toolUses.map((tool: any) => ({
                name: tool.name,
              }))

              // Convert Anthropic tool_choice format to match OpenAI format for tracking
              const adaptedToolChoice =
                toolChoice.type === 'tool' ? { function: { name: toolChoice.name } } : toolChoice

              const result = trackForcedToolUsage(
                adaptedToolCalls,
                adaptedToolChoice,
                logger,
                'anthropic',
                forcedTools,
                usedForcedTools
              )
              // Make the behavior consistent with the initial check
              hasUsedForcedTool = result.hasUsedForcedTool
              usedForcedTools = result.usedForcedTools
              return result
            }
          }
          return null
        }

        // Check if a forced tool was used in the first response
        checkForForcedToolUsage(currentResponse, originalToolChoice)

        try {
          while (iterationCount < MAX_ITERATIONS) {
            // Check for tool calls
            const toolUses = currentResponse.content.filter((item) => item.type === 'tool_use')
            if (!toolUses || toolUses.length === 0) {
              break
            }

            // Track time for tool calls in this batch
            const toolsStartTime = Date.now()

            // Process each tool call
            for (const toolUse of toolUses) {
              try {
                const toolName = toolUse.name
                const toolArgs = toolUse.input as Record<string, any>

                // Get the tool from the tools registry
                const tool = request.tools?.find((t) => t.id === toolName)
                if (!tool) continue

                // Execute the tool
                const toolCallStartTime = Date.now()

                // Only merge actual tool parameters for logging
                const toolParams = {
                  ...tool.params,
                  ...toolArgs,
                }

                // Add system parameters for execution
                const executionParams = {
                  ...toolParams,
                  ...(request.workflowId
                    ? {
                        _context: {
                          workflowId: request.workflowId,
                          ...(request.chatId ? { chatId: request.chatId } : {}),
                        },
                      }
                    : {}),
                  ...(request.environmentVariables
                    ? { envVars: request.environmentVariables }
                    : {}),
                }

                const result = await executeTool(toolName, executionParams, true)
                const toolCallEndTime = Date.now()
                const toolCallDuration = toolCallEndTime - toolCallStartTime

                // Add to time segments for both success and failure
                timeSegments.push({
                  type: 'tool',
                  name: toolName,
                  startTime: toolCallStartTime,
                  endTime: toolCallEndTime,
                  duration: toolCallDuration,
                })

                // Prepare result content for the LLM
                let resultContent: any
                if (result.success) {
                  toolResults.push(result.output)
                  resultContent = result.output
                } else {
                  // Include error information so LLM can respond appropriately
                  resultContent = {
                    error: true,
                    message: result.error || 'Tool execution failed',
                    tool: toolName,
                  }
                }

                toolCalls.push({
                  name: toolName,
                  arguments: toolParams,
                  startTime: new Date(toolCallStartTime).toISOString(),
                  endTime: new Date(toolCallEndTime).toISOString(),
                  duration: toolCallDuration,
                  result: resultContent,
                  success: result.success,
                })

                // Add the tool call and result to messages (both success and failure)
                const toolUseId = generateToolUseId(toolName)

                currentMessages.push({
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool_use',
                      id: toolUseId,
                      name: toolName,
                      input: toolArgs,
                    } as any,
                  ],
                })

                currentMessages.push({
                  role: 'user',
                  content: [
                    {
                      type: 'tool_result',
                      tool_use_id: toolUseId,
                      content: JSON.stringify(resultContent),
                    } as any,
                  ],
                })
              } catch (error) {
                logger.error('Error processing tool call:', { error })
              }
            }

            // Calculate tool call time for this iteration
            const thisToolsTime = Date.now() - toolsStartTime
            toolsTime += thisToolsTime

            // Make the next request with updated messages
            const nextPayload = {
              ...payload,
              messages: currentMessages,
            }

            // Update tool_choice based on which forced tools have been used
            if (
              typeof originalToolChoice === 'object' &&
              hasUsedForcedTool &&
              forcedTools.length > 0
            ) {
              // If we have remaining forced tools, get the next one to force
              const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

              if (remainingTools.length > 0) {
                // Force the next tool - use Anthropic format
                nextPayload.tool_choice = {
                  type: 'tool',
                  name: remainingTools[0],
                }
                logger.info(`Forcing next tool: ${remainingTools[0]}`)
              } else {
                // All forced tools have been used, switch to auto by removing tool_choice
                nextPayload.tool_choice = undefined
                logger.info('All forced tools have been used, removing tool_choice parameter')
              }
            } else if (hasUsedForcedTool && typeof originalToolChoice === 'object') {
              // Handle the case of a single forced tool that was used
              nextPayload.tool_choice = undefined
              logger.info(
                'Removing tool_choice parameter for subsequent requests after forced tool was used'
              )
            }

            // Time the next model call
            const nextModelStartTime = Date.now()

            // Make the next request
            currentResponse = await anthropic.messages.create(nextPayload)

            // Check if any forced tools were used in this response
            checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)

            const nextModelEndTime = Date.now()
            const thisModelTime = nextModelEndTime - nextModelStartTime

            // Add to time segments
            timeSegments.push({
              type: 'model',
              name: `Model response (iteration ${iterationCount + 1})`,
              startTime: nextModelStartTime,
              endTime: nextModelEndTime,
              duration: thisModelTime,
            })

            // Add to model time
            modelTime += thisModelTime

            // Update content if we have a text response
            const textContent = currentResponse.content
              .filter((item) => item.type === 'text')
              .map((item) => item.text)
              .join('\n')

            if (textContent) {
              content = textContent
            }

            // Update token counts
            if (currentResponse.usage) {
              tokens.prompt += currentResponse.usage.input_tokens || 0
              tokens.completion += currentResponse.usage.output_tokens || 0
              tokens.total +=
                (currentResponse.usage.input_tokens || 0) +
                (currentResponse.usage.output_tokens || 0)
            }

            iterationCount++
          }
        } catch (error) {
          logger.error('Error in Anthropic request:', { error })
          throw error
        }

        // If the content looks like it contains JSON, extract just the JSON part
        if (content.includes('{') && content.includes('}')) {
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/m)
            if (jsonMatch) {
              content = jsonMatch[0]
            }
          } catch (e) {
            logger.error('Error extracting JSON from response:', { error: e })
          }
        }

        // Calculate overall timing
        const providerEndTime = Date.now()
        const providerEndTimeISO = new Date(providerEndTime).toISOString()
        const totalDuration = providerEndTime - providerStartTime

        // For non-streaming mode with tools, we stream only the final response
        if (iterationCount > 0) {
          logger.info(
            'Using streaming for final Anthropic response after tool calls (non-streaming mode)'
          )

          // When streaming after tool calls with forced tools, make sure tool_choice is removed
          // This prevents the API from trying to force tool usage again in the final streaming response
          const streamingPayload = {
            ...payload,
            messages: currentMessages,
            // For Anthropic, omit tool_choice entirely rather than setting it to 'none'
            stream: true,
          }

          // Remove the tool_choice parameter as Anthropic doesn't accept 'none' as a string value
          streamingPayload.tool_choice = undefined

          const streamResponse: any = await anthropic.messages.create(streamingPayload)

          // Create a StreamingExecution response with all collected data
          const streamingResult = {
            stream: createReadableStreamFromAnthropicStream(streamResponse),
            execution: {
              success: true,
              output: {
                content: '', // Will be filled by the callback
                model: request.model || 'claude-3-7-sonnet-20250219',
                tokens: {
                  prompt: tokens.prompt,
                  completion: tokens.completion,
                  total: tokens.total,
                },
                toolCalls:
                  toolCalls.length > 0
                    ? {
                        list: toolCalls,
                        count: toolCalls.length,
                      }
                    : undefined,
                providerTiming: {
                  startTime: providerStartTimeISO,
                  endTime: new Date().toISOString(),
                  duration: Date.now() - providerStartTime,
                  modelTime: modelTime,
                  toolsTime: toolsTime,
                  firstResponseTime: firstResponseTime,
                  iterations: iterationCount + 1,
                  timeSegments: timeSegments,
                },
                cost: {
                  total: (tokens.total || 0) * 0.0001, // Estimate cost based on tokens
                  input: (tokens.prompt || 0) * 0.0001,
                  output: (tokens.completion || 0) * 0.0001,
                },
              },
              logs: [], // No block logs at provider level
              metadata: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: Date.now() - providerStartTime,
              },
              isStreaming: true,
            },
          }

          return streamingResult as StreamingExecution
        }

        // If no tool calls were made, return a direct response
        return {
          content,
          model: request.model || 'claude-3-7-sonnet-20250219',
          tokens,
          toolCalls:
            toolCalls.length > 0
              ? toolCalls.map((tc) => ({
                  name: tc.name,
                  arguments: tc.arguments as Record<string, any>,
                  startTime: tc.startTime,
                  endTime: tc.endTime,
                  duration: tc.duration,
                  result: tc.result,
                }))
              : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          timing: {
            startTime: providerStartTimeISO,
            endTime: providerEndTimeISO,
            duration: totalDuration,
            modelTime: modelTime,
            toolsTime: toolsTime,
            firstResponseTime: firstResponseTime,
            iterations: iterationCount + 1,
            timeSegments: timeSegments,
          },
        }
      } catch (error) {
        // Include timing information even for errors
        const providerEndTime = Date.now()
        const providerEndTimeISO = new Date(providerEndTime).toISOString()
        const totalDuration = providerEndTime - providerStartTime

        logger.error('Error in Anthropic request:', {
          error,
          duration: totalDuration,
        })

        // Create a new error with timing information
        const enhancedError = new Error(error instanceof Error ? error.message : String(error))
        // @ts-ignore - Adding timing property to the error
        enhancedError.timing = {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
        }

        throw enhancedError
      }
    }

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      // Make the initial API request
      const initialCallTime = Date.now()

      // Track the original tool_choice for forced tool tracking
      const originalToolChoice = payload.tool_choice

      // Track forced tools and their usage
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      let currentResponse = await anthropic.messages.create(payload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = ''

      // Extract text content from the message
      if (Array.isArray(currentResponse.content)) {
        content = currentResponse.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n')
      }

      const tokens = {
        prompt: currentResponse.usage?.input_tokens || 0,
        completion: currentResponse.usage?.output_tokens || 0,
        total:
          (currentResponse.usage?.input_tokens || 0) + (currentResponse.usage?.output_tokens || 0),
      }

      const toolCalls = []
      const toolResults = []
      const currentMessages = [...messages]
      let iterationCount = 0
      const MAX_ITERATIONS = 10 // Prevent infinite loops

      // Track if a forced tool has been used
      let hasUsedForcedTool = false

      // Track time spent in model vs tools
      let modelTime = firstResponseTime
      let toolsTime = 0

      // Track each model and tool call segment with timestamps
      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      // Helper function to check for forced tool usage in Anthropic responses
      const checkForForcedToolUsage = (response: any, toolChoice: any) => {
        if (
          typeof toolChoice === 'object' &&
          toolChoice !== null &&
          Array.isArray(response.content)
        ) {
          const toolUses = response.content.filter((item: any) => item.type === 'tool_use')

          if (toolUses.length > 0) {
            // Convert Anthropic tool_use format to a format trackForcedToolUsage can understand
            const adaptedToolCalls = toolUses.map((tool: any) => ({
              name: tool.name,
            }))

            // Convert Anthropic tool_choice format to match OpenAI format for tracking
            const adaptedToolChoice =
              toolChoice.type === 'tool' ? { function: { name: toolChoice.name } } : toolChoice

            const result = trackForcedToolUsage(
              adaptedToolCalls,
              adaptedToolChoice,
              logger,
              'anthropic',
              forcedTools,
              usedForcedTools
            )
            // Make the behavior consistent with the initial check
            hasUsedForcedTool = result.hasUsedForcedTool
            usedForcedTools = result.usedForcedTools
            return result
          }
        }
        return null
      }

      // Check if a forced tool was used in the first response
      checkForForcedToolUsage(currentResponse, originalToolChoice)

      try {
        while (iterationCount < MAX_ITERATIONS) {
          // Check for tool calls
          const toolUses = currentResponse.content.filter((item) => item.type === 'tool_use')
          if (!toolUses || toolUses.length === 0) {
            break
          }

          // Track time for tool calls in this batch
          const toolsStartTime = Date.now()

          // Process each tool call
          for (const toolUse of toolUses) {
            try {
              const toolName = toolUse.name
              const toolArgs = toolUse.input as Record<string, any>

              // Get the tool from the tools registry
              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) continue

              // Execute the tool
              const toolCallStartTime = Date.now()

              // Only merge actual tool parameters for logging
              const toolParams = {
                ...tool.params,
                ...toolArgs,
              }

              // Add system parameters for execution
              const executionParams = {
                ...toolParams,
                ...(request.workflowId
                  ? {
                      _context: {
                        workflowId: request.workflowId,
                        ...(request.chatId ? { chatId: request.chatId } : {}),
                      },
                    }
                  : {}),
                ...(request.environmentVariables ? { envVars: request.environmentVariables } : {}),
              }

              const result = await executeTool(toolName, executionParams, true)
              const toolCallEndTime = Date.now()
              const toolCallDuration = toolCallEndTime - toolCallStartTime

              // Add to time segments for both success and failure
              timeSegments.push({
                type: 'tool',
                name: toolName,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallDuration,
              })

              // Prepare result content for the LLM
              let resultContent: any
              if (result.success) {
                toolResults.push(result.output)
                resultContent = result.output
              } else {
                // Include error information so LLM can respond appropriately
                resultContent = {
                  error: true,
                  message: result.error || 'Tool execution failed',
                  tool: toolName,
                }
              }

              toolCalls.push({
                name: toolName,
                arguments: toolParams,
                startTime: new Date(toolCallStartTime).toISOString(),
                endTime: new Date(toolCallEndTime).toISOString(),
                duration: toolCallDuration,
                result: resultContent,
                success: result.success,
              })

              // Add the tool call and result to messages (both success and failure)
              const toolUseId = generateToolUseId(toolName)

              currentMessages.push({
                role: 'assistant',
                content: [
                  {
                    type: 'tool_use',
                    id: toolUseId,
                    name: toolName,
                    input: toolArgs,
                  } as any,
                ],
              })

              currentMessages.push({
                role: 'user',
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: toolUseId,
                    content: JSON.stringify(resultContent),
                  } as any,
                ],
              })
            } catch (error) {
              logger.error('Error processing tool call:', { error })
            }
          }

          // Calculate tool call time for this iteration
          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          // Make the next request with updated messages
          const nextPayload = {
            ...payload,
            messages: currentMessages,
          }

          // Update tool_choice based on which forced tools have been used
          if (
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
            // If we have remaining forced tools, get the next one to force
            const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

            if (remainingTools.length > 0) {
              // Force the next tool - use Anthropic format
              nextPayload.tool_choice = {
                type: 'tool',
                name: remainingTools[0],
              }
              logger.info(`Forcing next tool: ${remainingTools[0]}`)
            } else {
              // All forced tools have been used, switch to auto by removing tool_choice
              nextPayload.tool_choice = undefined
              logger.info('All forced tools have been used, removing tool_choice parameter')
            }
          } else if (hasUsedForcedTool && typeof originalToolChoice === 'object') {
            // Handle the case of a single forced tool that was used
            nextPayload.tool_choice = undefined
            logger.info(
              'Removing tool_choice parameter for subsequent requests after forced tool was used'
            )
          }

          // Time the next model call
          const nextModelStartTime = Date.now()

          // Make the next request
          currentResponse = await anthropic.messages.create(nextPayload)

          // Check if any forced tools were used in this response
          checkForForcedToolUsage(currentResponse, nextPayload.tool_choice)

          const nextModelEndTime = Date.now()
          const thisModelTime = nextModelEndTime - nextModelStartTime

          // Add to time segments
          timeSegments.push({
            type: 'model',
            name: `Model response (iteration ${iterationCount + 1})`,
            startTime: nextModelStartTime,
            endTime: nextModelEndTime,
            duration: thisModelTime,
          })

          // Add to model time
          modelTime += thisModelTime

          // Update content if we have a text response
          const textContent = currentResponse.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('\n')

          if (textContent) {
            content = textContent
          }

          // Update token counts
          if (currentResponse.usage) {
            tokens.prompt += currentResponse.usage.input_tokens || 0
            tokens.completion += currentResponse.usage.output_tokens || 0
            tokens.total +=
              (currentResponse.usage.input_tokens || 0) + (currentResponse.usage.output_tokens || 0)
          }

          iterationCount++
        }
      } catch (error) {
        logger.error('Error in Anthropic request:', { error })
        throw error
      }

      // If the content looks like it contains JSON, extract just the JSON part
      if (content.includes('{') && content.includes('}')) {
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/m)
          if (jsonMatch) {
            content = jsonMatch[0]
          }
        } catch (e) {
          logger.error('Error extracting JSON from response:', { error: e })
        }
      }

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      // After all tool processing complete, if streaming was requested and we have messages, use streaming for the final response
      if (request.stream && iterationCount > 0) {
        logger.info('Using streaming for final Anthropic response after tool calls')

        // When streaming after tool calls with forced tools, make sure tool_choice is removed
        // This prevents the API from trying to force tool usage again in the final streaming response
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          // For Anthropic, omit tool_choice entirely rather than setting it to 'none'
          stream: true,
        }

        // Remove the tool_choice parameter as Anthropic doesn't accept 'none' as a string value
        streamingPayload.tool_choice = undefined

        const streamResponse: any = await anthropic.messages.create(streamingPayload)

        // Create a StreamingExecution response with all collected data
        const streamingResult = {
          stream: createReadableStreamFromAnthropicStream(streamResponse),
          execution: {
            success: true,
            output: {
              content: '', // Will be filled by the callback
              model: request.model || 'claude-3-7-sonnet-20250219',
              tokens: {
                prompt: tokens.prompt,
                completion: tokens.completion,
                total: tokens.total,
              },
              toolCalls:
                toolCalls.length > 0
                  ? {
                      list: toolCalls,
                      count: toolCalls.length,
                    }
                  : undefined,
              providerTiming: {
                startTime: providerStartTimeISO,
                endTime: new Date().toISOString(),
                duration: Date.now() - providerStartTime,
                modelTime: modelTime,
                toolsTime: toolsTime,
                firstResponseTime: firstResponseTime,
                iterations: iterationCount + 1,
                timeSegments: timeSegments,
              },
              cost: {
                total: (tokens.total || 0) * 0.0001, // Estimate cost based on tokens
                input: (tokens.prompt || 0) * 0.0001,
                output: (tokens.completion || 0) * 0.0001,
              },
            },
            logs: [], // No block logs at provider level
            metadata: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
            },
            isStreaming: true,
          },
        }

        return streamingResult as StreamingExecution
      }

      return {
        content,
        model: request.model || 'claude-3-7-sonnet-20250219',
        tokens,
        toolCalls:
          toolCalls.length > 0
            ? toolCalls.map((tc) => ({
                name: tc.name,
                arguments: tc.arguments as Record<string, any>,
                startTime: tc.startTime,
                endTime: tc.endTime,
                duration: tc.duration,
                result: tc.result,
              }))
            : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timing: {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
          modelTime: modelTime,
          toolsTime: toolsTime,
          firstResponseTime: firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments: timeSegments,
        },
      }
    } catch (error) {
      // Include timing information even for errors
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Anthropic request:', {
        error,
        duration: totalDuration,
      })

      // Create a new error with timing information
      const enhancedError = new Error(error instanceof Error ? error.message : String(error))
      // @ts-ignore - Adding timing property to the error
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }

      throw enhancedError
    }
  },
}
