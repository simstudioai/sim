import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@/lib/logs/console/logger'
import type { StreamingExecution } from '@/executor/types'
import { executeTool } from '@/tools'
import { getProviderDefaultModel, getProviderModels } from '../models'
import type { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'
import { prepareToolExecution, prepareToolsWithUsageControl, trackForcedToolUsage } from '../utils'

const logger = createLogger('AnthropicProvider')

/**
 * Helper to wrap Anthropic streaming into a browser-friendly ReadableStream
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

    // Initialize Anthropic client with beta headers if requested
    const anthropic = request.betas?.length
      ? new Anthropic({
          apiKey: request.apiKey,
          defaultHeaders: {
            'anthropic-beta': request.betas.join(','),
          },
        })
      : new Anthropic({ apiKey: request.apiKey })

    // Helper function to generate a simple unique ID for tool uses
    const generateToolUseId = (toolName: string) => {
      return `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    }

    // Transform messages to Anthropic format
    const messages: any[] = []

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
      ? request.tools.map((tool, index) => {
          // Handle native Anthropic tool types (like tool_search_tool_regex)
          if ((tool as any).type?.startsWith('tool_search_tool')) {
            return tool as any // Pass through native tools as-is
          }

          // Get schema - check both input_schema (from superagent) and parameters (from agent block)
          const toolAny = tool as any
          const schema = toolAny.input_schema || tool.parameters || {}

          // Validate and sanitize properties to ensure valid JSON Schema
          const properties: Record<string, any> = {}
          if (schema.properties && typeof schema.properties === 'object') {
            for (const [key, value] of Object.entries(schema.properties)) {
              if (value && typeof value === 'object') {
                const prop = value as any
                // Ensure type is a valid JSON Schema type
                const validTypes = [
                  'string',
                  'number',
                  'integer',
                  'boolean',
                  'array',
                  'object',
                  'null',
                ]
                const propType = prop.type || 'string'

                if (validTypes.includes(propType)) {
                  properties[key] = {
                    type: propType,
                    ...(prop.description ? { description: String(prop.description) } : {}),
                    ...(prop.items && propType === 'array' ? { items: prop.items } : {}),
                    ...(prop.enum ? { enum: prop.enum } : {}),
                  }
                }
              }
            }
          }

          // Validate required array
          const required = Array.isArray(schema.required)
            ? schema.required.filter((r: any) => typeof r === 'string' && properties[r])
            : []

          // Transform regular tools
          return {
            name: tool.id || toolAny.name,
            description: tool.description || '',
            input_schema: {
              type: 'object',
              properties,
              required,
            },
            ...(toolAny.defer_loading !== undefined
              ? { defer_loading: toolAny.defer_loading }
              : {}),
          }
        })
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

    // Log beta features (they're sent as headers via the client, not in payload)
    if (request.betas?.length) {
      logger.info('Using beta features via header', { betas: request.betas })
    }

    // Use the tools in the payload
    if (anthropicTools?.length) {
      payload.tools = anthropicTools
      // Only set tool_choice if it's not 'auto'
      if (toolChoice !== 'auto') {
        payload.tool_choice = toolChoice
      }
    }

    // Always stream tool calls for better UX - this streams text before/after/between tool calls
    const shouldStreamToolCalls = true

    // EARLY STREAMING: if caller requested streaming and there are no tools to execute,
    // we can directly stream the completion.
    if (request.stream && (!anthropicTools || anthropicTools.length === 0)) {
      logger.info('Using streaming response for Anthropic request (no tools)')

      // Start execution timer for the entire provider execution
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      // Create a streaming request
      // Create streaming request - use beta client if betas are present
      const streamPayload = {
        ...payload,
        stream: true,
      }

      const streamResponse: any = request.betas?.length
        ? await anthropic.beta.messages.create(streamPayload)
        : await anthropic.messages.create(streamPayload)

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

    // TOOL EXECUTION PATH: Execute all tool calls with streaming
    if (anthropicTools && anthropicTools.length > 0 && request.stream) {
      logger.info('Executing Anthropic request with fully streaming tools and text', {
        toolCount: anthropicTools.length,
      })

      // Start execution timer
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      // Create a custom streaming implementation that handles tool execution
      const customStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          const tokens = { prompt: 0, completion: 0, total: 0 }
          const toolCalls: any[] = []
          const currentMessages = [...messages]
          let iterationCount = 0
          const MAX_ITERATIONS = 10

          try {
            while (iterationCount < MAX_ITERATIONS) {
              logger.info(`Iteration ${iterationCount + 1}: Calling Anthropic`)

              // Make streaming call
              const streamPayload = {
                ...payload,
                messages: currentMessages,
                stream: true,
              }

              const streamResponse: any = request.betas?.length
                ? await anthropic.beta.messages.create(streamPayload)
                : await anthropic.messages.create(streamPayload)

              let hasToolCalls = false
              const pendingToolCalls: any[] = []
              let accumulatedText = ''

              // Process stream events
              for await (const event of streamResponse) {
                // Log raw SSE event from Anthropic
                logger.info('Raw Anthropic SSE', {
                  type: event.type,
                  index: event.index,
                  contentBlockType: event.content_block?.type,
                  deltaType: event.delta?.type,
                  raw: JSON.stringify(event).slice(0, 800),
                })

                // Stream text deltas
                if (event.type === 'content_block_delta' && event.delta?.text) {
                  const text = event.delta.text
                  accumulatedText += text

                  // Stream text to client
                  const textChunk = { type: 'text', text }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`))
                }

                // Detect tool use
                if (
                  event.type === 'content_block_start' &&
                  event.content_block?.type === 'tool_use'
                ) {
                  hasToolCalls = true
                  const toolUse = { ...event.content_block, blockIndex: event.index }
                  pendingToolCalls.push(toolUse)

                  logger.info('Tool use detected', {
                    toolName: toolUse.name,
                    blockIndex: event.index,
                    toolUseId: toolUse.id,
                  })

                  // Stream tool call start event
                  const toolStartChunk = {
                    type: 'tool_call',
                    name: toolUse.name,
                    status: 'calling',
                  }
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolStartChunk)}\n\n`))
                }

                // Accumulate tool input as it streams
                if (
                  event.type === 'content_block_delta' &&
                  event.delta?.type === 'input_json_delta'
                ) {
                  const blockIndex = event.index
                  // Find the tool call with matching blockIndex
                  const toolCall = pendingToolCalls.find((t: any) => t.blockIndex === blockIndex)
                  if (toolCall) {
                    if (!toolCall.input_json) {
                      toolCall.input_json = ''
                    }
                    toolCall.input_json += event.delta.partial_json
                  } else {
                    logger.warn('No matching tool call for input_json_delta', {
                      blockIndex,
                      pendingCount: pendingToolCalls.length,
                    })
                  }
                }

                // Track usage
                if (event.type === 'message_delta' && event.usage) {
                  tokens.prompt += event.usage.input_tokens || 0
                  tokens.completion += event.usage.output_tokens || 0
                  tokens.total = tokens.prompt + tokens.completion
                }
              }

              // If no tool calls, we're done
              if (!hasToolCalls || pendingToolCalls.length === 0) {
                break
              }

              // Prepare all tool executions
              const toolExecutionPromises = pendingToolCalls.map(async (toolUse) => {
                const toolName = toolUse.name
                const toolUseId = toolUse.id || generateToolUseId(toolName)

                logger.info('Raw tool use before parsing', {
                  toolName,
                  toolUseId,
                  hasInputJson: !!toolUse.input_json,
                  inputJsonLength: toolUse.input_json?.length || 0,
                  inputJsonPreview: toolUse.input_json?.slice(0, 300),
                  hasInput: !!toolUse.input,
                  inputKeys: toolUse.input ? Object.keys(toolUse.input) : [],
                })

                const toolInput = toolUse.input_json
                  ? JSON.parse(toolUse.input_json)
                  : toolUse.input || {}

                logger.info('Processing tool call', {
                  toolName,
                  toolUseId,
                  toolInput: JSON.stringify(toolInput).slice(0, 500),
                  toolInputKeys: Object.keys(toolInput),
                })

                // Find tool in registry
                const tool = request.tools?.find(
                  (t: any) => t.id === toolName || t.name === toolName
                )
                if (!tool) {
                  logger.warn(`Tool not found: ${toolName}`)
                  return {
                    toolName,
                    toolUseId,
                    toolInput,
                    result: { success: false, error: `Tool not found: ${toolName}`, output: null },
                    toolParams: {},
                  }
                }

                logger.info('Found tool in registry', {
                  toolName,
                  hasParams: !!(tool as any).params,
                  paramsKeys: Object.keys((tool as any).params || {}),
                })

                // Execute tool
                const { toolParams, executionParams } = prepareToolExecution(
                  tool,
                  toolInput,
                  request
                )

                logger.info('Prepared tool execution', {
                  toolName,
                  toolParamsKeys: Object.keys(toolParams),
                  hasAccessToken: !!toolParams.accessToken,
                })

                let result: any
                try {
                  // Try custom tool executor first (for built-in tools not in registry)
                  if (request.customToolExecutor) {
                    const customResult = await request.customToolExecutor(toolName, toolInput)
                    if (customResult !== null) {
                      result = customResult
                    }
                  }
                  // Fall back to standard executeTool if no custom result
                  if (!result) {
                    result = await executeTool(toolName, executionParams, true)
                  }
                } catch (execError) {
                  result = {
                    success: false,
                    error: execError instanceof Error ? execError.message : String(execError),
                    output: null,
                  }
                  logger.error('Tool execution threw exception', { toolName, error: result.error })
                }

                return { toolName, toolUseId, toolInput, result, toolParams }
              })

              // Execute all tools in parallel
              logger.info('Executing tools in parallel', { count: toolExecutionPromises.length })
              const toolResults = await Promise.all(toolExecutionPromises)
              logger.info('All parallel tool executions completed', { count: toolResults.length })

              // Build assistant message with all tool_use blocks
              const assistantToolUseBlocks = toolResults.map(({ toolName, toolUseId, toolInput }) => ({
                type: 'tool_use' as const,
                id: toolUseId,
                name: toolName,
                input: toolInput,
              }))

              // Build user message with all tool_result blocks
              const userToolResultBlocks = toolResults.map(({ toolUseId, result }) => ({
                type: 'tool_result' as const,
                tool_use_id: toolUseId,
                content: JSON.stringify(result.output),
              }))

              // Stream tool completion events and track results
              for (const { toolName, result, toolParams } of toolResults) {
                toolCalls.push({
                  name: toolName,
                  arguments: toolParams,
                  result: result.output,
                  success: result.success,
                })

                const toolCompleteChunk = {
                  type: 'tool_call',
                  name: toolName,
                  status: result.success ? 'success' : 'error',
                  result: result.output,
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolCompleteChunk)}\n\n`))
              }

              // Add to message history - single assistant message with all tool uses,
              // followed by single user message with all tool results
              currentMessages.push({
                role: 'assistant',
                content: assistantToolUseBlocks,
              })
              currentMessages.push({
                role: 'user',
                content: userToolResultBlocks,
              })

              iterationCount++
            }

            // Send done event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
            controller.close()
          } catch (error) {
            logger.error('Streaming tool execution error', { error })
            controller.error(error)
          }
        },
      })

      // Return streaming execution
      return {
        stream: customStream,
        execution: {
          success: true,
          output: {
            content: '',
            model: request.model,
            tokens: { prompt: 0, completion: 0, total: 0 },
          },
          logs: [],
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: 0,
          },
          isStreaming: true,
        },
      } as StreamingExecution
    }

    // NON-STREAMING TOOL EXECUTION PATH (original code)
    if (anthropicTools && anthropicTools.length > 0) {
      logger.info('Executing Anthropic request with tools (non-streaming)', {
        toolCount: anthropicTools.length,
      })

      // Start execution timer
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      try {
        // Make the initial streaming API request
        const initialCallTime = Date.now()

        // Track the original tool_choice for forced tool tracking
        const originalToolChoice = payload.tool_choice

        // Track forced tools and their usage
        const forcedTools = preparedTools?.forcedTools || []
        let usedForcedTools: string[] = []

        // Make non-streaming call for tool execution
        const toolPayload = {
          ...payload,
          stream: false,
        }

        // Call the API - use beta client if betas are present
        let currentResponse = request.betas?.length
          ? await anthropic.beta.messages.create(toolPayload)
          : await anthropic.messages.create(toolPayload)
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

            // Prepare all tool executions for parallel processing
            logger.info('Preparing parallel tool executions', { count: toolUses.length })

            const toolExecutionPromises = toolUses.map(async (toolUse) => {
              const toolName = toolUse.name
              const toolArgs = toolUse.input as Record<string, any>
              const toolUseId = toolUse.id || generateToolUseId(toolName)
              const toolCallStartTime = Date.now()

              // Get the tool from the tools registry
              // Check both 'id' and 'name' fields since deferred tools use 'name'
              const tool = request.tools?.find(
                (t: any) => t.id === toolName || t.name === toolName
              )
              if (!tool) {
                logger.warn(`Tool ${toolName} not found in registry`, {
                  availableTools: request.tools?.map((t: any) => t.id || t.name).slice(0, 10),
                })
                return {
                  toolName,
                  toolUseId,
                  toolArgs,
                  toolParams: {},
                  result: { success: false, error: `Tool not found: ${toolName}`, output: null },
                  startTime: toolCallStartTime,
                  endTime: Date.now(),
                  duration: Date.now() - toolCallStartTime,
                }
              }

              logger.info('Executing tool', { toolName, hasParams: !!tool.params })

              const { toolParams, executionParams } = prepareToolExecution(
                tool,
                toolArgs,
                request
              )

              // Use general tool system for requests
              let result: any
              try {
                // Try custom tool executor first (for built-in tools not in registry)
                if (request.customToolExecutor) {
                  const customResult = await request.customToolExecutor(toolName, toolArgs)
                  if (customResult !== null) {
                    result = customResult
                  }
                }
                // Fall back to standard executeTool if no custom result
                if (!result) {
                  result = await executeTool(toolName, executionParams, true)
                }
              } catch (execError) {
                // Tool threw an exception - convert to error result
                result = {
                  success: false,
                  error: execError instanceof Error ? execError.message : String(execError),
                  output: null,
                }
              }

              const toolCallEndTime = Date.now()
              const toolCallDuration = toolCallEndTime - toolCallStartTime

              logger.info('Tool execution completed', {
                toolName,
                success: result.success,
                duration: toolCallDuration,
              })

              return {
                toolName,
                toolUseId,
                toolArgs,
                toolParams,
                result,
                startTime: toolCallStartTime,
                endTime: toolCallEndTime,
                duration: toolCallDuration,
              }
            })

            // Execute all tools in parallel
            const parallelResults = await Promise.all(toolExecutionPromises)
            logger.info('All parallel tool executions completed', { count: parallelResults.length })

            // Build assistant message with all tool_use blocks
            const assistantToolUseBlocks = parallelResults.map(({ toolName, toolUseId, toolArgs }) => ({
              type: 'tool_use' as const,
              id: toolUseId,
              name: toolName,
              input: toolArgs,
            }))

            // Build user message with all tool_result blocks
            const userToolResultBlocks = parallelResults.map(({ toolUseId, result }) => {
              const resultContent = result.success
                ? result.output
                : { error: true, message: result.error || 'Tool execution failed' }
              return {
                type: 'tool_result' as const,
                tool_use_id: toolUseId,
                content: JSON.stringify(resultContent),
                is_error: !result.success,
              }
            })

            // Process results for tracking
            for (const execResult of parallelResults) {
              const { toolName, toolParams, result, startTime, endTime, duration } = execResult

              // Add to time segments for both success and failure
              timeSegments.push({
                type: 'tool',
                name: toolName,
                startTime,
                endTime,
                duration,
              })

              // Prepare result content for tracking
              const resultContent = result.success
                ? result.output
                : { error: true, message: result.error || 'Tool execution failed', tool: toolName }

              if (result.success) {
                toolResults.push(result.output)
              }

              toolCalls.push({
                name: toolName,
                arguments: toolParams,
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                duration,
                result: resultContent,
                success: result.success,
              })
            }

            // Add to message history - single assistant message with all tool uses,
            // followed by single user message with all tool results
            currentMessages.push({
              role: 'assistant',
              content: assistantToolUseBlocks as any,
            })
            currentMessages.push({
              role: 'user',
              content: userToolResultBlocks as any,
            })

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

              const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)

              // Use general tool system for requests
              let result: any
              try {
                // Try custom tool executor first (for built-in tools not in registry)
                if (request.customToolExecutor) {
                  const customResult = await request.customToolExecutor(toolName, toolArgs)
                  if (customResult !== null) {
                    result = customResult
                  }
                }
                // Fall back to standard executeTool if no custom result
                if (!result) {
                  result = await executeTool(toolName, executionParams, true)
                }
              } catch (execError) {
                // Tool threw an exception - convert to error result
                result = {
                  success: false,
                  error: execError instanceof Error ? execError.message : String(execError),
                  output: null,
                }
              }

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
                    is_error: !result.success, // Mark as error for Anthropic
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

      // After all tool processing complete, if streaming was requested, use streaming for the final response
      if (request.stream) {
        logger.info('Using streaming for final Anthropic response after tool processing')

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

        const streamResponse: any = request.betas?.length
          ? await anthropic.beta.messages.create(streamingPayload)
          : await anthropic.messages.create(streamingPayload)

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
