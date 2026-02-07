import type { Logger } from '@sim/logger'
import type OpenAI from 'openai'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import type { Message, ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'
import {
  buildResponsesInputFromMessages,
  convertResponseOutputToInputItems,
  convertToolsToResponses,
  createReadableStreamFromResponses,
  extractResponseText,
  extractResponseToolCalls,
  parseResponsesUsage,
  type ResponsesInputItem,
  type ResponsesToolCall,
  toResponsesToolChoice,
} from './utils'

type PreparedTools = ReturnType<typeof prepareToolsWithUsageControl>
type ToolChoice = PreparedTools['toolChoice']

/**
 * Recursively enforces OpenAI strict mode requirements on a JSON schema.
 * - Sets additionalProperties: false on all object types.
 * - Ensures required includes ALL property keys.
 */
function enforceStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return schema

  const result = { ...schema }

  // If this is an object type, enforce strict requirements
  if (result.type === 'object') {
    result.additionalProperties = false

    // Recursively process properties and ensure required includes all keys
    if (result.properties && typeof result.properties === 'object') {
      const propKeys = Object.keys(result.properties as Record<string, unknown>)
      result.required = propKeys // Strict mode requires ALL properties
      result.properties = Object.fromEntries(
        Object.entries(result.properties as Record<string, unknown>).map(([key, value]) => [
          key,
          enforceStrictSchema(value as Record<string, unknown>),
        ])
      )
    }
  }

  // Handle array items
  if (result.type === 'array' && result.items) {
    result.items = enforceStrictSchema(result.items as Record<string, unknown>)
  }

  // Handle anyOf, oneOf, allOf
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(result[keyword])) {
      result[keyword] = (result[keyword] as Record<string, unknown>[]).map(enforceStrictSchema)
    }
  }

  // Handle $defs / definitions
  for (const defKey of ['$defs', 'definitions']) {
    if (result[defKey] && typeof result[defKey] === 'object') {
      result[defKey] = Object.fromEntries(
        Object.entries(result[defKey] as Record<string, unknown>).map(([key, value]) => [
          key,
          enforceStrictSchema(value as Record<string, unknown>),
        ])
      )
    }
  }

  return result
}

export interface ResponsesProviderConfig {
  providerId: string
  providerLabel: string
  modelName: string
  endpoint: string
  headers: Record<string, string>
  logger: Logger
}

/**
 * Executes a Responses API request with tool-loop handling and streaming support.
 */
export async function executeResponsesProviderRequest(
  request: ProviderRequest,
  config: ResponsesProviderConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { logger } = config

  logger.info(`Preparing ${config.providerLabel} request`, {
    model: request.model,
    hasSystemPrompt: !!request.systemPrompt,
    hasMessages: !!request.messages?.length,
    hasTools: !!request.tools?.length,
    toolCount: request.tools?.length || 0,
    hasResponseFormat: !!request.responseFormat,
    stream: !!request.stream,
  })

  const allMessages: Message[] = []

  if (request.systemPrompt) {
    allMessages.push({
      role: 'system',
      content: request.systemPrompt,
    })
  }

  if (request.context) {
    allMessages.push({
      role: 'user',
      content: request.context,
    })
  }

  if (request.messages) {
    allMessages.push(...request.messages)
  }

  const initialInput = buildResponsesInputFromMessages(allMessages)

  const basePayload: Record<string, unknown> = {
    model: config.modelName,
  }

  if (request.temperature !== undefined) basePayload.temperature = request.temperature
  if (request.maxTokens != null) basePayload.max_output_tokens = request.maxTokens

  if (request.reasoningEffort !== undefined && request.reasoningEffort !== 'auto') {
    basePayload.reasoning = {
      effort: request.reasoningEffort,
      summary: 'auto',
    }
  }

  if (request.verbosity !== undefined && request.verbosity !== 'auto') {
    basePayload.text = {
      ...((basePayload.text as Record<string, unknown>) ?? {}),
      verbosity: request.verbosity,
    }
  }

  // Store response format config - for Azure with tools, we defer applying it until after tool calls complete
  let deferredTextFormat: OpenAI.Responses.ResponseFormatTextJSONSchemaConfig | undefined
  const hasTools = !!request.tools?.length
  const isAzure = config.providerId === 'azure-openai'

  if (request.responseFormat) {
    const isStrict = request.responseFormat.strict !== false
    const rawSchema = request.responseFormat.schema || request.responseFormat
    // OpenAI strict mode requires additionalProperties: false on ALL nested objects
    const cleanedSchema = isStrict ? enforceStrictSchema(rawSchema) : rawSchema

    const textFormat = {
      type: 'json_schema' as const,
      name: request.responseFormat.name || 'response_schema',
      schema: cleanedSchema,
      strict: isStrict,
    }

    // Azure OpenAI has issues combining tools + response_format in the same request
    // Defer the format until after tool calls complete for Azure
    if (isAzure && hasTools) {
      deferredTextFormat = textFormat
      logger.info(
        `Deferring JSON schema response format for ${config.providerLabel} (will apply after tool calls complete)`
      )
    } else {
      basePayload.text = {
        ...((basePayload.text as Record<string, unknown>) ?? {}),
        format: textFormat,
      }
      logger.info(`Added JSON schema response format to ${config.providerLabel} request`)
    }
  }

  const tools = request.tools?.length
    ? request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.id,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    : undefined

  let preparedTools: PreparedTools | null = null
  let responsesToolChoice: ReturnType<typeof toResponsesToolChoice> | undefined
  let trackingToolChoice: ToolChoice | undefined

  if (tools?.length) {
    preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, config.providerId)
    const { tools: filteredTools, toolChoice } = preparedTools
    trackingToolChoice = toolChoice

    if (filteredTools?.length) {
      const convertedTools = convertToolsToResponses(filteredTools)
      if (!convertedTools.length) {
        throw new Error('All tools have empty names')
      }

      basePayload.tools = convertedTools
      basePayload.parallel_tool_calls = true
    }

    if (toolChoice) {
      responsesToolChoice = toResponsesToolChoice(toolChoice)
      if (responsesToolChoice) {
        basePayload.tool_choice = responsesToolChoice
      }

      logger.info(`${config.providerLabel} request configuration:`, {
        toolCount: filteredTools?.length || 0,
        toolChoice:
          typeof toolChoice === 'string'
            ? toolChoice
            : toolChoice.type === 'function'
              ? `force:${toolChoice.function?.name}`
              : toolChoice.type === 'tool'
                ? `force:${toolChoice.name}`
                : toolChoice.type === 'any'
                  ? `force:${toolChoice.any?.name || 'unknown'}`
                  : 'unknown',
        model: config.modelName,
      })
    }
  }

  const createRequestBody = (
    input: ResponsesInputItem[],
    overrides: Record<string, unknown> = {}
  ) => ({
    ...basePayload,
    input,
    ...overrides,
  })

  const parseErrorResponse = async (response: Response): Promise<string> => {
    const text = await response.text()
    try {
      const payload = JSON.parse(text)
      return payload?.error?.message || text
    } catch {
      return text
    }
  }

  const postResponses = async (
    body: Record<string, unknown>
  ): Promise<OpenAI.Responses.Response> => {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const message = await parseErrorResponse(response)
      throw new Error(`${config.providerLabel} API error (${response.status}): ${message}`)
    }

    return response.json()
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info(`Using streaming response for ${config.providerLabel} request`)

      const streamResponse = await fetch(config.endpoint, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(createRequestBody(initialInput, { stream: true })),
      })

      if (!streamResponse.ok) {
        const message = await parseErrorResponse(streamResponse)
        throw new Error(`${config.providerLabel} API error (${streamResponse.status}): ${message}`)
      }

      const streamingResult = {
        stream: createReadableStreamFromResponses(streamResponse, (content, usage) => {
          streamingResult.execution.output.content = content
          streamingResult.execution.output.tokens = {
            input: usage?.promptTokens || 0,
            output: usage?.completionTokens || 0,
            total: usage?.totalTokens || 0,
          }

          const costResult = calculateCost(
            request.model,
            usage?.promptTokens || 0,
            usage?.completionTokens || 0
          )
          streamingResult.execution.output.cost = {
            input: costResult.input,
            output: costResult.output,
            total: costResult.total,
          }

          const streamEndTime = Date.now()
          const streamEndTimeISO = new Date(streamEndTime).toISOString()

          if (streamingResult.execution.output.providerTiming) {
            streamingResult.execution.output.providerTiming.endTime = streamEndTimeISO
            streamingResult.execution.output.providerTiming.duration =
              streamEndTime - providerStartTime

            if (streamingResult.execution.output.providerTiming.timeSegments?.[0]) {
              streamingResult.execution.output.providerTiming.timeSegments[0].endTime =
                streamEndTime
              streamingResult.execution.output.providerTiming.timeSegments[0].duration =
                streamEndTime - providerStartTime
            }
          }
        }),
        execution: {
          success: true,
          output: {
            content: '',
            model: request.model,
            tokens: { input: 0, output: 0, total: 0 },
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
            cost: { input: 0, output: 0, total: 0 },
          },
          logs: [],
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
          },
        },
      } as StreamingExecution

      return streamingResult as StreamingExecution
    }

    const initialCallTime = Date.now()
    const forcedTools = preparedTools?.forcedTools || []
    let usedForcedTools: string[] = []
    let hasUsedForcedTool = false
    let currentToolChoice = responsesToolChoice
    let currentTrackingToolChoice = trackingToolChoice

    const checkForForcedToolUsage = (
      toolCallsInResponse: ResponsesToolCall[],
      toolChoice: ToolChoice | undefined
    ) => {
      if (typeof toolChoice === 'object' && toolCallsInResponse.length > 0) {
        const result = trackForcedToolUsage(
          toolCallsInResponse,
          toolChoice,
          logger,
          config.providerId,
          forcedTools,
          usedForcedTools
        )
        hasUsedForcedTool = result.hasUsedForcedTool
        usedForcedTools = result.usedForcedTools
      }
    }

    const currentInput: ResponsesInputItem[] = [...initialInput]
    let currentResponse = await postResponses(
      createRequestBody(currentInput, { tool_choice: currentToolChoice })
    )
    const firstResponseTime = Date.now() - initialCallTime

    const initialUsage = parseResponsesUsage(currentResponse.usage)
    const tokens = {
      input: initialUsage?.promptTokens || 0,
      output: initialUsage?.completionTokens || 0,
      total: initialUsage?.totalTokens || 0,
    }

    const toolCalls = []
    const toolResults = []
    let iterationCount = 0
    let modelTime = firstResponseTime
    let toolsTime = 0
    let content = extractResponseText(currentResponse.output) || ''

    const timeSegments: TimeSegment[] = [
      {
        type: 'model',
        name: 'Initial response',
        startTime: initialCallTime,
        endTime: initialCallTime + firstResponseTime,
        duration: firstResponseTime,
      },
    ]

    checkForForcedToolUsage(
      extractResponseToolCalls(currentResponse.output),
      currentTrackingToolChoice
    )

    while (iterationCount < MAX_TOOL_ITERATIONS) {
      const responseText = extractResponseText(currentResponse.output)
      if (responseText) {
        content = responseText
      }

      const toolCallsInResponse = extractResponseToolCalls(currentResponse.output)
      if (!toolCallsInResponse.length) {
        break
      }

      const outputInputItems = convertResponseOutputToInputItems(currentResponse.output)
      if (outputInputItems.length) {
        currentInput.push(...outputInputItems)
      }

      logger.info(
        `Processing ${toolCallsInResponse.length} tool calls in parallel (iteration ${
          iterationCount + 1
        }/${MAX_TOOL_ITERATIONS})`
      )

      const toolsStartTime = Date.now()

      const toolExecutionPromises = toolCallsInResponse.map(async (toolCall) => {
        const toolCallStartTime = Date.now()
        const toolName = toolCall.name

        try {
          const toolArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : {}
          const tool = request.tools?.find((t) => t.id === toolName)

          if (!tool) {
            return null
          }

          const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
          const result = await executeTool(toolName, executionParams)
          const toolCallEndTime = Date.now()

          return {
            toolCall,
            toolName,
            toolParams,
            result,
            startTime: toolCallStartTime,
            endTime: toolCallEndTime,
            duration: toolCallEndTime - toolCallStartTime,
          }
        } catch (error) {
          const toolCallEndTime = Date.now()
          logger.error('Error processing tool call:', { error, toolName })

          return {
            toolCall,
            toolName,
            toolParams: {},
            result: {
              success: false,
              output: undefined,
              error: error instanceof Error ? error.message : 'Tool execution failed',
            },
            startTime: toolCallStartTime,
            endTime: toolCallEndTime,
            duration: toolCallEndTime - toolCallStartTime,
          }
        }
      })

      const executionResults = await Promise.allSettled(toolExecutionPromises)

      for (const settledResult of executionResults) {
        if (settledResult.status === 'rejected' || !settledResult.value) continue

        const { toolCall, toolName, toolParams, result, startTime, endTime, duration } =
          settledResult.value

        timeSegments.push({
          type: 'tool',
          name: toolName,
          startTime: startTime,
          endTime: endTime,
          duration: duration,
        })

        let resultContent: Record<string, unknown>
        if (result.success) {
          toolResults.push(result.output)
          resultContent = result.output as Record<string, unknown>
        } else {
          resultContent = {
            error: true,
            message: result.error || 'Tool execution failed',
            tool: toolName,
          }
        }

        toolCalls.push({
          name: toolName,
          arguments: toolParams,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          duration: duration,
          result: resultContent,
          success: result.success,
        })

        currentInput.push({
          type: 'function_call_output',
          call_id: toolCall.id,
          output: JSON.stringify(resultContent),
        })
      }

      const thisToolsTime = Date.now() - toolsStartTime
      toolsTime += thisToolsTime

      if (typeof currentToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
        const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

        if (remainingTools.length > 0) {
          currentToolChoice = {
            type: 'function',
            name: remainingTools[0],
          }
          currentTrackingToolChoice = {
            type: 'function',
            function: { name: remainingTools[0] },
          }
          logger.info(`Forcing next tool: ${remainingTools[0]}`)
        } else {
          currentToolChoice = 'auto'
          currentTrackingToolChoice = 'auto'
          logger.info('All forced tools have been used, switching to auto tool_choice')
        }
      }

      const nextModelStartTime = Date.now()

      currentResponse = await postResponses(
        createRequestBody(currentInput, { tool_choice: currentToolChoice })
      )

      checkForForcedToolUsage(
        extractResponseToolCalls(currentResponse.output),
        currentTrackingToolChoice
      )

      const latestText = extractResponseText(currentResponse.output)
      if (latestText) {
        content = latestText
      }

      const nextModelEndTime = Date.now()
      const thisModelTime = nextModelEndTime - nextModelStartTime

      timeSegments.push({
        type: 'model',
        name: `Model response (iteration ${iterationCount + 1})`,
        startTime: nextModelStartTime,
        endTime: nextModelEndTime,
        duration: thisModelTime,
      })

      modelTime += thisModelTime

      const usage = parseResponsesUsage(currentResponse.usage)
      if (usage) {
        tokens.input += usage.promptTokens
        tokens.output += usage.completionTokens
        tokens.total += usage.totalTokens
      }

      iterationCount++
    }

    // For Azure with deferred format: make a final call with the response format applied
    // This happens whenever we have a deferred format, even if no tools were called
    // (the initial call was made without the format, so we need to apply it now)
    let appliedDeferredFormat = false
    if (deferredTextFormat) {
      logger.info(
        `Applying deferred JSON schema response format for ${config.providerLabel} (iterationCount: ${iterationCount})`
      )

      const finalFormatStartTime = Date.now()

      // Determine what input to use for the formatted call
      let formattedInput: ResponsesInputItem[]

      if (iterationCount > 0) {
        // Tools were called - include the conversation history with tool results
        const lastOutputItems = convertResponseOutputToInputItems(currentResponse.output)
        if (lastOutputItems.length) {
          currentInput.push(...lastOutputItems)
        }
        formattedInput = currentInput
      } else {
        // No tools were called - just retry the initial call with format applied
        // Don't include the model's previous unformatted response
        formattedInput = initialInput
      }

      // Make final call with the response format - build payload without tools
      const finalPayload: Record<string, unknown> = {
        model: config.modelName,
        input: formattedInput,
        text: {
          ...((basePayload.text as Record<string, unknown>) ?? {}),
          format: deferredTextFormat,
        },
      }

      // Copy over non-tool related settings
      if (request.temperature !== undefined) finalPayload.temperature = request.temperature
      if (request.maxTokens != null) finalPayload.max_output_tokens = request.maxTokens
      if (request.reasoningEffort !== undefined && request.reasoningEffort !== 'auto') {
        finalPayload.reasoning = {
          effort: request.reasoningEffort,
          summary: 'auto',
        }
      }
      if (request.verbosity !== undefined && request.verbosity !== 'auto') {
        finalPayload.text = {
          ...((finalPayload.text as Record<string, unknown>) ?? {}),
          verbosity: request.verbosity,
        }
      }

      currentResponse = await postResponses(finalPayload)

      const finalFormatEndTime = Date.now()
      const finalFormatDuration = finalFormatEndTime - finalFormatStartTime

      timeSegments.push({
        type: 'model',
        name: 'Final formatted response',
        startTime: finalFormatStartTime,
        endTime: finalFormatEndTime,
        duration: finalFormatDuration,
      })

      modelTime += finalFormatDuration

      const finalUsage = parseResponsesUsage(currentResponse.usage)
      if (finalUsage) {
        tokens.input += finalUsage.promptTokens
        tokens.output += finalUsage.completionTokens
        tokens.total += finalUsage.totalTokens
      }

      // Update content with the formatted response
      const formattedText = extractResponseText(currentResponse.output)
      if (formattedText) {
        content = formattedText
      }

      appliedDeferredFormat = true
    }

    // Skip streaming if we already applied deferred format - we have the formatted content
    // Making another streaming call would lose the formatted response
    if (request.stream && !appliedDeferredFormat) {
      logger.info('Using streaming for final response after tool processing')

      const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

      // For Azure with deferred format in streaming mode, include the format in the streaming call
      const streamOverrides: Record<string, unknown> = { stream: true, tool_choice: 'auto' }
      if (deferredTextFormat) {
        streamOverrides.text = {
          ...((basePayload.text as Record<string, unknown>) ?? {}),
          format: deferredTextFormat,
        }
      }

      const streamResponse = await fetch(config.endpoint, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(createRequestBody(currentInput, streamOverrides)),
      })

      if (!streamResponse.ok) {
        const message = await parseErrorResponse(streamResponse)
        throw new Error(`${config.providerLabel} API error (${streamResponse.status}): ${message}`)
      }

      const streamingResult = {
        stream: createReadableStreamFromResponses(streamResponse, (content, usage) => {
          streamingResult.execution.output.content = content
          streamingResult.execution.output.tokens = {
            input: tokens.input + (usage?.promptTokens || 0),
            output: tokens.output + (usage?.completionTokens || 0),
            total: tokens.total + (usage?.totalTokens || 0),
          }

          const streamCost = calculateCost(
            request.model,
            usage?.promptTokens || 0,
            usage?.completionTokens || 0
          )
          streamingResult.execution.output.cost = {
            input: accumulatedCost.input + streamCost.input,
            output: accumulatedCost.output + streamCost.output,
            total: accumulatedCost.total + streamCost.total,
          }
        }),
        execution: {
          success: true,
          output: {
            content: '',
            model: request.model,
            tokens: {
              input: tokens.input,
              output: tokens.output,
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
              input: accumulatedCost.input,
              output: accumulatedCost.output,
              total: accumulatedCost.total,
            },
          },
          logs: [],
          metadata: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
          },
        },
      } as StreamingExecution

      return streamingResult as StreamingExecution
    }

    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    return {
      content,
      model: request.model,
      tokens,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    logger.error(`Error in ${config.providerLabel} request:`, {
      error,
      duration: totalDuration,
    })

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
