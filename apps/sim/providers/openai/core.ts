import { createHash } from 'node:crypto'
import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type OpenAI from 'openai'
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { createOpenAIResponsesStreamingToolLoopStream } from '@/providers/openai/streaming-tool-loop'
import { enrichLastModelSegmentFromOpenAIResponse } from '@/providers/openai/trace'
import {
  addOpenAIUsage,
  buildOpenAIUsageCost,
  buildOpenAIUsageTokens,
  createOpenAIUsageAccumulator,
} from '@/providers/openai/usage'
import { executeProviderTool } from '@/providers/runtime-context'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { isAbortError, parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import type { Message, ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  enforceStrictSchema,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  supportsReasoningEffort,
  trackForcedToolUsage,
} from '@/providers/utils'
import {
  buildResponsesInputFromMessages,
  convertResponseOutputToInputItems,
  convertToolsToResponses,
  createReadableStreamFromResponses,
  extractResponseText,
  extractResponseToolCalls,
  isMaxOutputTokensIncompleteResponse,
  parseResponsesUsage,
  type ResponsesInputItem,
  type ResponsesToolCall,
  responseContainsFunctionCall,
  toResponsesToolChoice,
} from './utils'

/**
 * Rejects a `/v1/responses` body reporting a generation that did not succeed — the
 * endpoint answers HTTP 200 for both `status: 'failed'` and `status: 'incomplete'`.
 *
 * The tolerated case must stay matched to `streamResponsesTurn`: `incomplete` is accepted
 * only when truncated by `max_output_tokens` AND carrying no function call. Truncated
 * prose is a usable partial answer, but a truncated `function_call` holds half-written
 * JSON that makes `parseToolArguments` throw a confusing tool failure.
 *
 * An absent `status` is deliberately not treated as a failure: this path is shared with
 * Azure OpenAI and OpenAI-compatible gateways.
 */
function assertUsableResponse(response: OpenAI.Responses.Response, providerLabel: string): void {
  if (response.error) {
    const code = response.error.code ? ` (${response.error.code})` : ''
    throw new Error(`${providerLabel} generation failed${code}: ${response.error.message}`)
  }

  if (response.status === 'failed') {
    throw new Error(
      `${providerLabel} generation failed, and the API returned no error detail explaining why.`
    )
  }

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason ?? 'unknown'
    if (responseContainsFunctionCall(response)) {
      throw new Error(
        `${providerLabel} generation stopped before completion (${reason}), truncating a tool call mid-argument. Raise the max output tokens or reduce the tool schema size.`
      )
    }
    if (!isMaxOutputTokensIncompleteResponse(response)) {
      throw new Error(`${providerLabel} generation stopped before completion: ${reason}.`)
    }
    return
  }

  if (response.status && response.status !== 'completed') {
    throw new Error(
      `${providerLabel} returned a response with status "${response.status}", which carries no finished generation.`
    )
  }
}

/**
 * Transport failures annotated once already. The error-body read is annotated where the
 * phase is known, then rethrown through an outer catch that would otherwise append a
 * second, wrong phase to the same message.
 */
const annotatedTransportFailures = new WeakSet<Error>()

type PreparedTools = ReturnType<typeof prepareToolsWithUsageControl>
type ToolChoice = PreparedTools['toolChoice']

/**
 * Stable routing key for OpenAI's prompt cache, scoped to one agent block.
 *
 * Per-block rather than per-workflow: two blocks in the same workflow have
 * different prefixes, so sharing a key would pull them onto the same engine and
 * lower the hit rate. Hashed so no internal identifier leaves the system.
 * Returns `undefined` when the caller has no stable identity to key on.
 */
function buildPromptCacheKey(request: ProviderRequest): string | undefined {
  if (!request.workflowId || !request.blockId) return undefined
  return createHash('sha256')
    .update(`${request.workflowId}:${request.blockId}`)
    .digest('hex')
    .slice(0, 32)
}

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
    workflowId: request.workflowId,
    blockId: request.blockId,
    executionId: request.executionId,
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

  /**
   * OpenAI prompt caching is automatic and free, so there is nothing to toggle
   * — but requests only hit a warm cache when they route to the same engine.
   * A stable key per agent block sharpens that routing and is required for
   * reliable matching on GPT-5.6+.
   *
   * `prompt_cache_key` is absent from the pinned SDK's typings, which is
   * harmless: this body is a plain object posted through `fetch`, never
   * `responses.create()`. Do not delete it as an unknown parameter.
   */
  const promptCacheKey = buildPromptCacheKey(request)
  if (promptCacheKey) basePayload.prompt_cache_key = promptCacheKey

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

    basePayload.text = {
      ...((basePayload.text as Record<string, unknown>) ?? {}),
      format: textFormat,
    }
    logger.info(`Added JSON schema response format to ${config.providerLabel} request`)
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

  /**
   * Names the request phase an opaque transport failure died in.
   *
   * Bun raises only `TimeoutError: The operation timed out.`, which cannot distinguish
   * "never answered" from "answered, but the body never arrived" — opposite owners,
   * opposite fixes. undici splits these as `UND_ERR_HEADERS_TIMEOUT` vs
   * `UND_ERR_BODY_TIMEOUT`; this records the equivalent for a runtime that reports
   * neither.
   *
   * The phase rides the error message because that reaches the block's trace span, which
   * survives when a task has stopped shipping logs; `x-request-id` is the only handle the
   * provider can trace the call by. Self-describing API errors are left untouched.
   */
  const annotateTransportFailure = (
    error: unknown,
    phase: 'awaiting-response-headers' | 'reading-response-body',
    startedAt: number,
    detail?: Record<string, string | number | null>
  ): unknown => {
    if (!(error instanceof Error)) return error
    if (error.name !== 'TimeoutError' && error.name !== 'AbortError') return error
    if (annotatedTransportFailures.has(error)) return error

    const elapsedMs = Date.now() - startedAt
    const fields = Object.entries(detail ?? {})
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
    const context = [`phase=${phase}`, `elapsedMs=${elapsedMs}`, ...fields].join(' ')

    logger.error(`${config.providerLabel} request failed in transport`, {
      phase,
      elapsedMs,
      errorName: error.name,
      model: config.modelName,
      workflowId: request.workflowId,
      blockId: request.blockId,
      executionId: request.executionId,
      ...detail,
    })

    /**
     * A new Error rather than a mutation: the runtime raises these as `DOMException`,
     * whose `message` is a readonly getter, so assigning to it throws a `TypeError` and
     * destroys the very failure being reported. `name` is copied and the original hangs
     * off `cause` so the classification survives the `ProviderError` wrapping below,
     * which overwrites `name`.
     */
    const annotated = new Error(`${error.message} [${context}]`, { cause: error })
    annotated.name = error.name
    annotatedTransportFailures.add(annotated)
    return annotated
  }

  /**
   * The response-side facts worth carrying on a transport failure. `x-request-id` is the
   * only handle the provider can trace a failed call by.
   */
  const describeResponse = (response: Response): Record<string, string | number | null> => ({
    status: response.status,
    requestId: response.headers.get('x-request-id'),
    contentLength: response.headers.get('content-length'),
    contentEncoding: response.headers.get('content-encoding'),
  })

  /**
   * A non-JSON body is usually a gateway or CDN error page and reaches the user-facing
   * block error, so it is bounded and falls back to `statusText`. A structured provider
   * message is returned untruncated on purpose: the reasoning-summary strip-and-retry
   * fallback matches on its text.
   *
   * A failed body read is annotated rather than swallowed: a deadline or a cancellation
   * here must stay distinguishable from an error response that simply carried no body.
   * The headers already arrived, so this is the body phase even though the status is 4xx.
   */
  const parseErrorResponse = async (response: Response, startedAt: number): Promise<string> => {
    let text: string
    try {
      text = await response.text()
    } catch (error) {
      throw annotateTransportFailure(
        error,
        'reading-response-body',
        startedAt,
        describeResponse(response)
      )
    }
    try {
      const payload = JSON.parse(text)
      if (payload?.error?.message) return payload.error.message
    } catch {}
    return truncate(text.trim(), 500) || response.statusText || `HTTP ${response.status}`
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

  let reasoningSummariesUnavailable = false

  /**
   * The single point every Responses request leaves through, so a stall waiting for
   * headers is named on the streaming paths too — they call
   * {@link fetchResponsesWithSummaryFallback} directly and never reach `postResponses`,
   * which is where the annotation used to live.
   */
  const postOnce = async (
    payload: Record<string, unknown>,
    abortSignal: AbortSignal | undefined,
    startedAt: number
  ): Promise<Response> => {
    try {
      return await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(payload),
        signal: abortSignal,
      })
    } catch (error) {
      throw annotateTransportFailure(error, 'awaiting-response-headers', startedAt)
    }
  }

  const fetchResponsesWithSummaryFallback = async (
    requestedBody: Record<string, unknown>,
    startedAt: number,
    abortSignal = request.abortSignal
  ): Promise<Response> => {
    const body = reasoningSummariesUnavailable
      ? (stripReasoningSummary(requestedBody) ?? requestedBody)
      : requestedBody
    const response = await postOnce(body, abortSignal, startedAt)
    if (response.ok) return response

    const message = await parseErrorResponse(response, startedAt)
    const strippedBody = isReasoningSummaryVerificationError(response.status, message)
      ? stripReasoningSummary(body)
      : null
    if (!strippedBody) {
      throw new Error(`${config.providerLabel} API error (${response.status}): ${message}`)
    }

    reasoningSummariesUnavailable = true
    logger.warn(
      `${config.providerLabel} rejected reasoning summaries (organization not verified); retrying without summary`,
      { model: config.modelName }
    )
    const retryResponse = await postOnce(strippedBody, abortSignal, startedAt)
    if (!retryResponse.ok) {
      const retryMessage = await parseErrorResponse(retryResponse, startedAt)
      throw new Error(
        `${config.providerLabel} API error (${retryResponse.status}): ${retryMessage}`
      )
    }
    return retryResponse
  }

  const postResponses = async (
    body: Record<string, unknown>
  ): Promise<OpenAI.Responses.Response> => {
    const startedAt = Date.now()

    const response = await fetchResponsesWithSummaryFallback(body, startedAt)

    const responseMeta = { ...describeResponse(response), ttfbMs: Date.now() - startedAt }

    let parsed: OpenAI.Responses.Response
    try {
      parsed = await response.json()
    } catch (error) {
      throw annotateTransportFailure(error, 'reading-response-body', startedAt, responseMeta)
    }

    /**
     * Placed here so every tool-loop turn is covered, and outside the transport `try` so
     * a rejected generation is not misreported as a transport failure.
     */
    assertUsableResponse(parsed, config.providerLabel)
    return parsed
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    const hasActiveTools = Array.isArray(basePayload.tools) && basePayload.tools.length > 0

    if (request.stream && hasActiveTools) {
      logger.info(`Using live streaming tool loop for ${config.providerLabel} request`)
      const timeSegments: TimeSegment[] = []

      return createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: {
          kind: 'accumulated',
          modelTime: 0,
          toolsTime: 0,
          firstResponseTime: 0,
          iterations: 1,
          timeSegments,
        },
        initialTokens: { input: 0, output: 0, total: 0 },
        initialCost: { input: 0, output: 0, total: 0 },
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createOpenAIResponsesStreamingToolLoopStream({
            providerId: config.providerId,
            providerLabel: config.providerLabel,
            request,
            initialInput,
            initialToolChoice: responsesToolChoice,
            forcedTools: preparedTools?.forcedTools,
            createStream: (input, overrides, abortSignal) =>
              fetchResponsesWithSummaryFallback(
                createRequestBody(input, overrides),
                Date.now(),
                abortSignal
              ),
            logger,
            timeSegments,
            onComplete: (result) => {
              output.content = result.content
              output.tokens = result.tokens
              output.cost = result.cost
              output.toolCalls = result.toolCalls as NormalizedBlockOutput['toolCalls']
              if (output.providerTiming) {
                output.providerTiming.modelTime = result.modelTime
                output.providerTiming.toolsTime = result.toolsTime
                output.providerTiming.firstResponseTime = result.firstResponseTime
                output.providerTiming.iterations = result.iterations
              }
              finalizeTiming()
            },
          }),
      })
    }

    if (request.stream && !hasActiveTools) {
      logger.info(`Using streaming response for ${config.providerLabel} request`)

      const streamResponse = await fetchResponsesWithSummaryFallback(
        createRequestBody(initialInput, { stream: true }),
        Date.now()
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
            const accumulator = createOpenAIUsageAccumulator()
            addOpenAIUsage(accumulator, usage)

            output.content = content
            output.tokens = buildOpenAIUsageTokens(accumulator)
            output.cost = buildOpenAIUsageCost(request.model, accumulator)

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

    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, parseResponsesUsage(currentResponse.usage))

    const toolCalls = []
    const toolResults: Record<string, unknown>[] = []
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
          const toolArgs = parseToolArguments(toolCall.arguments, toolName)
          const tool = request.tools?.find((t) => t.id === toolName)

          if (!tool) {
            const toolCallEndTime = Date.now()
            return {
              toolCall,
              toolName,
              toolParams: {},
              result: {
                success: false,
                output: undefined,
                error: `Tool "${toolName}" is not available`,
              },
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallEndTime - toolCallStartTime,
            }
          }

          const { toolParams, executionParams } = prepareToolExecution(
            tool,
            toolArgs,
            request,
            toolCall.id
          )
          const { rawResponse, modelResponse } = await executeProviderTool(
            toolName,
            executionParams,
            {
              signal: request.abortSignal,
            }
          )
          const toolCallEndTime = Date.now()

          return {
            toolCall,
            toolName,
            toolParams,
            result: rawResponse,
            modelResult: modelResponse,
            startTime: toolCallStartTime,
            endTime: toolCallEndTime,
            duration: toolCallEndTime - toolCallStartTime,
          }
        } catch (error) {
          if (isAbortError(error) || request.abortSignal?.aborted) {
            throw error
          }
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

      const executionResults = await Promise.all(toolExecutionPromises)

      for (const executionResult of executionResults) {
        const { toolCall, toolName, toolParams, result, startTime, endTime, duration } =
          executionResult
        const modelResult =
          'modelResult' in executionResult && executionResult.modelResult
            ? executionResult.modelResult
            : result

        timeSegments.push({
          type: 'tool',
          name: toolName,
          startTime: startTime,
          endTime: endTime,
          duration: duration,
          toolCallId: toolCall.id,
        })

        let resultContent: unknown
        if (result.success) {
          if (isRecordLike(result.output)) {
            toolResults.push(result.output)
          }
          resultContent = result.output ?? null
        } else {
          resultContent = {
            error: true,
            message: result.error || 'Tool execution failed',
            tool: toolName,
          }
        }
        const modelResultContent = modelResult.success
          ? (modelResult.output ?? null)
          : {
              error: true,
              message: modelResult.error || 'Tool execution failed',
              tool: toolName,
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
          output: JSON.stringify(modelResultContent),
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

      addOpenAIUsage(usage, parseResponsesUsage(currentResponse.usage))

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

    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    return {
      content,
      model: request.model,
      tokens: buildOpenAIUsageTokens(usage),
      /**
       * No tool cost here: `executeProviderRequest` re-derives it from
       * `toolResults` for non-streaming responses, so folding it in would
       * double-charge it.
       */
      cost: buildOpenAIUsageCost(request.model, usage),
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

    if (isAbortError(error) || request.abortSignal?.aborted) {
      throw error
    }

    throw new ProviderError(
      toError(error).message,
      {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      },
      { cause: error }
    )
  }
}
