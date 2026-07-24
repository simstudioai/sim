import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type OpenAI from 'openai'
import type { IterationToolCall, StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import { enrichLastModelSegment, parseToolCallArguments } from '@/providers/trace-enrichment'
import type { Message, ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  calculateCost,
  enforceStrictSchema,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  sumToolCosts,
  supportsReasoningEffort,
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'
import {
  buildResponsesInputFromMessages,
  convertResponseOutputToInputItems,
  convertToolsToResponses,
  createReadableStreamFromResponses,
  extractResponseReasoning,
  extractResponseText,
  extractResponseToolCalls,
  parseResponsesUsage,
  type ResponsesInputItem,
  type ResponsesToolCall,
  toResponsesToolChoice,
} from './utils'

type PreparedTools = ReturnType<typeof prepareToolsWithUsageControl>
type ToolChoice = PreparedTools['toolChoice']

export interface ResponsesProviderConfig {
  providerId: string
  providerLabel: string
  modelName: string
  endpoint: string
  headers: Record<string, string>
  logger: Logger
  /**
   * Optional fetch implementation. Used to pin the connection to a pre-validated
   * IP (DNS-rebinding/SSRF protection) when the endpoint is user-supplied.
   * Defaults to the global fetch.
   */
  fetch?: typeof fetch
}

/**
 * Executes a Responses API request with tool-loop handling and streaming support.
 */
export async function executeResponsesProviderRequest(
  request: ProviderRequest,
  config: ResponsesProviderConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { logger } = config
  const fetchImpl = config.fetch ?? fetch

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

  const initialInput = buildResponsesInputFromMessages(allMessages, config.providerId)

  const basePayload: Record<string, unknown> = {
    model: config.modelName,
  }

  if (request.temperature !== undefined) basePayload.temperature = request.temperature
  if (request.maxTokens != null) basePayload.max_output_tokens = request.maxTokens

  /**
   * Reasoning summaries feed Thinking chrome. They are requested when an
   * explicit effort is set (pre-agent-events payload always paired
   * `summary: 'auto'` with `effort` — kept for parity) and on agent-events
   * runs even without an explicit effort. Summaries require OpenAI
   * organization verification; see the strip-and-retry fallback in the
   * request helpers below.
   */
  if (supportsReasoningEffort(config.modelName)) {
    const hasExplicitEffort =
      request.reasoningEffort !== undefined && request.reasoningEffort !== 'auto'
    const reasoning: Record<string, unknown> = {
      ...(request.agentEvents === true || hasExplicitEffort ? { summary: 'auto' } : {}),
      ...(hasExplicitEffort ? { effort: request.reasoningEffort } : {}),
    }
    if (Object.keys(reasoning).length > 0) {
      basePayload.reasoning = reasoning
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
    ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
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

  /**
   * OpenAI rejects `reasoning.summary` with a 400 for organizations that have
   * not completed verification. Summaries are best-effort chrome, so on that
   * specific failure the request is retried once without the summary field
   * rather than failing the run.
   */
  const isReasoningSummaryVerificationError = (status: number, message: string): boolean =>
    status === 400 &&
    message.includes('reasoning.summary') &&
    message.toLowerCase().includes('verif')

  const stripReasoningSummary = (body: Record<string, unknown>): Record<string, unknown> | null => {
    const reasoning = body.reasoning as Record<string, unknown> | undefined
    if (!reasoning || reasoning.summary === undefined) return null
    const { summary: _summary, ...reasoningRest } = reasoning
    const { reasoning: _reasoning, ...bodyRest } = body
    return Object.keys(reasoningRest).length > 0
      ? { ...bodyRest, reasoning: reasoningRest }
      : bodyRest
  }

  const fetchResponsesWithSummaryFallback = async (
    body: Record<string, unknown>
  ): Promise<Response> => {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(body),
      signal: request.abortSignal,
    })
    if (response.ok) return response

    const message = await parseErrorResponse(response)
    const strippedBody = isReasoningSummaryVerificationError(response.status, message)
      ? stripReasoningSummary(body)
      : null
    if (!strippedBody) {
      throw new Error(`${config.providerLabel} API error (${response.status}): ${message}`)
    }

    logger.warn(
      `${config.providerLabel} rejected reasoning summaries (organization not verified); retrying without summary`,
      { model: config.modelName }
    )
    const retryResponse = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(strippedBody),
      signal: request.abortSignal,
    })
    if (!retryResponse.ok) {
      const retryMessage = await parseErrorResponse(retryResponse)
      throw new Error(
        `${config.providerLabel} API error (${retryResponse.status}): ${retryMessage}`
      )
    }
    return retryResponse
  }

  const postResponses = async (
    body: Record<string, unknown>
  ): Promise<OpenAI.Responses.Response> => {
    const response = await fetchResponsesWithSummaryFallback(body)
    return response.json()
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    if (request.stream && (!tools || tools.length === 0)) {
      logger.info(`Using streaming response for ${config.providerLabel} request`)

      const streamResponse = await fetchResponsesWithSummaryFallback(
        createRequestBody(initialInput, { stream: true })
      )

      const streamingResult = createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: { kind: 'simple', segmentName: request.model },
        initialTokens: { input: 0, output: 0, total: 0 },
        initialCost: { input: 0, output: 0, total: 0 },
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createReadableStreamFromResponses(streamResponse, (content, usage, thinking) => {
            output.content = content
            output.tokens = {
              input: usage?.promptTokens || 0,
              output: usage?.completionTokens || 0,
              total: usage?.totalTokens || 0,
            }

            const costResult = calculateCost(
              request.model,
              usage?.promptTokens || 0,
              usage?.completionTokens || 0
            )
            output.cost = {
              input: costResult.input,
              output: costResult.output,
              total: costResult.total,
            }

            if (thinking) {
              const segment = output.providerTiming?.timeSegments?.[0]
              if (segment) {
                // Label honestly: these are reasoning *summaries*, not raw CoT.
                segment.thinkingContent = thinking
              }
            }

            finalizeTiming()
          }),
      })

      return streamingResult
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
    const toolResults: Record<string, unknown>[] = []
    /**
     * Executed calls in completion order, for settled tool chips on the
     * regenerated answer stream (the silent loop has no live stream to emit
     * lifecycle events on while tools actually run).
     */
    const toolLifecycle: Array<{ id: string; name: string; status: ToolCallEndStatus }> = []
    let iterationCount = 0
    let modelTime = firstResponseTime
    let toolsTime = 0
    let content = extractResponseText(currentResponse.output) || ''

    const timeSegments: TimeSegment[] = [
      {
        type: 'model',
        name: request.model,
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

      enrichLastModelSegmentFromOpenAIResponse(
        timeSegments,
        currentResponse,
        responseText,
        toolCallsInResponse,
        { model: request.model }
      )

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
          const result = await executeTool(toolName, executionParams, {
            signal: request.abortSignal,
          })
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
              error: getErrorMessage(error, 'Tool execution failed'),
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
          toolCallId: toolCall.id,
        })

        let resultContent: Record<string, unknown>
        if (result.success && result.output) {
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

        toolLifecycle.push({
          id: toolCall.id,
          name: toolName,
          status: result.success ? 'success' : 'error',
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
        name: request.model,
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

    if (iterationCount === MAX_TOOL_ITERATIONS) {
      const trailingText = extractResponseText(currentResponse.output)
      const trailingToolCalls = extractResponseToolCalls(currentResponse.output)
      enrichLastModelSegmentFromOpenAIResponse(
        timeSegments,
        currentResponse,
        trailingText,
        trailingToolCalls,
        { model: request.model }
      )
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
      if (supportsReasoningEffort(config.modelName) && basePayload.reasoning) {
        finalPayload.reasoning = basePayload.reasoning
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

      enrichLastModelSegmentFromOpenAIResponse(
        timeSegments,
        currentResponse,
        formattedText,
        extractResponseToolCalls(currentResponse.output),
        { model: request.model }
      )

      appliedDeferredFormat = true
    }

    // Skip streaming if we already applied deferred format - we have the formatted content
    // Making another streaming call would lose the formatted response
    if (request.stream && !appliedDeferredFormat) {
      logger.info('Using streaming for final response after tool processing')

      const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

      /**
       * The regeneration exists purely to stream the settled answer as prose —
       * streamed function calls are never executed. With `tool_choice: 'auto'`
       * a reasoning model can re-decide to call a tool here, ending the stream
       * with a dead function_call and an empty answer.
       */
      const streamOverrides: Record<string, unknown> = { stream: true, tool_choice: 'none' }
      if (deferredTextFormat) {
        streamOverrides.text = {
          ...((basePayload.text as Record<string, unknown>) ?? {}),
          format: deferredTextFormat,
        }
      }

      const streamResponse = await fetchResponsesWithSummaryFallback(
        createRequestBody(currentInput, streamOverrides)
      )

      const streamingResult = createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: {
          kind: 'accumulated',
          modelTime,
          toolsTime,
          firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments,
        },
        initialTokens: { input: tokens.input, output: tokens.output, total: tokens.total },
        initialCost: {
          input: accumulatedCost.input,
          output: accumulatedCost.output,
          total: accumulatedCost.total,
        },
        toolCalls: toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
        streamFormat: 'agent-events-v1',
        createStream: ({ output }) => {
          const answerStream = createReadableStreamFromResponses(
            streamResponse,
            (streamedContent, usage, thinking) => {
              /**
               * Belt-and-braces for the regeneration ending without text: keep
               * the tool loop's settled answer instead of clobbering it with an
               * empty string (clients then render it from the final envelope).
               */
              if (!streamedContent && content) {
                logger.warn(
                  `${config.providerLabel} final stream produced no text; keeping tool-loop answer`
                )
              }
              output.content = streamedContent || content
              output.tokens = {
                input: tokens.input + (usage?.promptTokens || 0),
                output: tokens.output + (usage?.completionTokens || 0),
                total: tokens.total + (usage?.totalTokens || 0),
              }

              const streamCost = calculateCost(
                request.model,
                usage?.promptTokens || 0,
                usage?.completionTokens || 0
              )
              const tc = sumToolCosts(toolResults)
              output.cost = {
                input: accumulatedCost.input + streamCost.input,
                output: accumulatedCost.output + streamCost.output,
                toolCost: tc || undefined,
                total: accumulatedCost.total + streamCost.total + tc,
              }

              if (thinking) {
                const lastModel = [...timeSegments].reverse().find((s) => s.type === 'model')
                if (lastModel) {
                  lastModel.thinkingContent = thinking
                }
              }
            }
          )

          if (toolLifecycle.length === 0) {
            return answerStream
          }

          /**
           * Settled tool chips ride ahead of the answer: the silent loop's
           * calls already completed, so opted-in consumers get start+end pairs
           * (name + status only) before the regenerated text streams. Runs
           * without a sink never see these events (the byte projection ignores
           * non-text), so legacy output is unchanged.
           */
          const answerReader = answerStream.getReader()
          return new ReadableStream<AgentStreamEvent>({
            start(controller) {
              for (const call of toolLifecycle) {
                controller.enqueue({ type: 'tool_call_start', id: call.id, name: call.name })
                controller.enqueue({
                  type: 'tool_call_end',
                  id: call.id,
                  name: call.name,
                  status: call.status,
                })
              }
            },
            async pull(controller) {
              const { done, value } = await answerReader.read()
              if (done) {
                controller.close()
                return
              }
              controller.enqueue(value)
            },
            cancel(reason) {
              return answerReader.cancel(reason)
            },
          })
        },
      })

      return streamingResult
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

    throw new ProviderError(toError(error).message, {
      startTime: providerStartTimeISO,
      endTime: providerEndTimeISO,
      duration: totalDuration,
    })
  }
}

/**
 * Determines a finish reason for an OpenAI Responses API response.
 * Maps to conventional values: 'tool_calls' | 'length' | 'stop'.
 */
function deriveOpenAIFinishReason(
  response: OpenAI.Responses.Response,
  toolCalls: ResponsesToolCall[]
): string | undefined {
  const incompleteReason = response.incomplete_details?.reason
  if (incompleteReason === 'max_output_tokens') return 'length'
  if (incompleteReason === 'content_filter') return 'content_filter'
  if (toolCalls.length > 0) return 'tool_calls'
  if (incompleteReason) return incompleteReason
  if (response.status === 'failed') return 'error'
  if (response.status === 'incomplete') return 'length'
  if (response.status && response.status !== 'completed') return response.status
  return 'stop'
}

/**
 * Enriches the last model segment with per-iteration content extracted from an
 * OpenAI Responses API response: assistant text, tool calls, finish reason,
 * and token usage for the iteration.
 */
function enrichLastModelSegmentFromOpenAIResponse(
  timeSegments: TimeSegment[],
  response: OpenAI.Responses.Response,
  assistantText: string,
  toolCallsInResponse: ResponsesToolCall[],
  extras?: {
    model?: string
    ttft?: number
    errorType?: string
    errorMessage?: string
  }
): void {
  const toolCalls: IterationToolCall[] = toolCallsInResponse.map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments:
      typeof tc.arguments === 'string' ? parseToolCallArguments(tc.arguments) : tc.arguments,
  }))

  const usage = parseResponsesUsage(response.usage)
  const thinkingContent = extractResponseReasoning(response.output)

  let cost: { input: number; output: number; total: number } | undefined
  if (extras?.model && usage) {
    const full = calculateCost(
      extras.model,
      usage.promptTokens,
      usage.completionTokens,
      usage.cachedTokens > 0
    )
    cost = { input: full.input, output: full.output, total: full.total }
  }

  enrichLastModelSegment(timeSegments, {
    assistantContent: assistantText || undefined,
    thinkingContent: thinkingContent || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: deriveOpenAIFinishReason(response, toolCallsInResponse),
    tokens: usage
      ? {
          input: usage.promptTokens,
          output: usage.completionTokens,
          total: usage.totalTokens,
          ...(usage.cachedTokens > 0 && { cacheRead: usage.cachedTokens }),
          ...(usage.reasoningTokens > 0 && { reasoning: usage.reasoningTokens }),
        }
      : undefined,
    cost,
    provider: 'openai',
    ttft: extras?.ttft,
    errorType: extras?.errorType,
    errorMessage: extras?.errorMessage,
  })
}
