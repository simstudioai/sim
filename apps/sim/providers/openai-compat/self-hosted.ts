import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import OpenAI from 'openai'
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import type { ReasoningEffort } from 'openai/resources/shared'
import { createPinnedFetch, validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import { getCachedProviderClient } from '@/providers/client-cache'
import {
  isConversationContextError,
  prepareConversationGeneration,
} from '@/providers/conversation-generation'
import {
  captureProviderConversationStep,
  recordProviderConversationToolError,
  recordProviderConversationUsage,
} from '@/providers/conversation-history'
import {
  createOpenAICompatAssistantHistory,
  type OpenAICompatReasoningField,
} from '@/providers/openai-compat/assistant-history'
import { getOpenAICompatibleApiBaseUrl } from '@/providers/openai-compat/base-url'
import { getChatCompletionConversationUsage } from '@/providers/openai-compat/conversation-usage'
import { listOpenAICompatibleModels } from '@/providers/openai-compat/model-list'
import { createOpenAICompatibleAgentEventStream } from '@/providers/openai-compat/stream-events'
import { createChatCompletionUsageMeter } from '@/providers/openai-compat/usage-meter'
import { buildJsonSchemaResponseFormat } from '@/providers/response-format'
import { executeProviderTool } from '@/providers/runtime-context'
import { createSettledAgentEventStream } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'
import {
  isAbortError,
  parseToolArguments,
  providerFailureLogLevel,
} from '@/providers/streaming-tool-loop-shared'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import { openAICompatTransport } from '@/providers/transport'
import type {
  FunctionCallResponse,
  Message,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  checkForForcedToolUsageOpenAI,
  enforceStrictSchema,
  isFunctionToolCall,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  sumToolCosts,
} from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers'

/** What differs between the operator-hosted OpenAI-compatible providers. */
export interface SelfHostedProviderConfig {
  providerId: 'vllm' | 'litellm'
  /** Display name used in logs and error messages, e.g. `vLLM`. */
  providerName: string
  logger: Logger
  /** Operator-configured server root or `/v1` base. Read per call so env changes apply. */
  getBaseUrl: () => string | undefined
  getApiKey: () => string | undefined
  /**
   * Honors `request.azureEndpoint` as a user-supplied server. That endpoint is
   * attacker-controlled, so it is validated against the `selfHostedService` egress
   * profile and the connection is pinned to the resolved IP.
   */
  allowRequestEndpoint: boolean
  maxTokensField: 'max_tokens' | 'max_completion_tokens'
  /** Sends `reasoning_effort` when the request sets one other than `auto`. */
  forwardReasoningEffort: boolean
  /**
   * `inline` sends the schema on every call, tools or not. `strict-deferred` sanitizes a
   * strict schema and, when tools are active, moves it to one extraction call after the
   * tool loop, since some backends cannot combine schema output with tools.
   */
  responseFormat: 'inline' | 'strict-deferred'
  /** Assistant reasoning fields replayed on tool-loop follow-ups. */
  reasoningFields: readonly OpenAICompatReasoningField[]
  /** Adds the tool `name` to tool result messages. */
  nameToolMessages: boolean
}

const JSON_FENCE_PATTERN = /```json\n?|\n?```/g

function stripJsonFences(content: string): string {
  return content.replace(JSON_FENCE_PATTERN, '').trim()
}

function describeToolChoice(toolChoice: ChatCompletionToolChoiceOption): string {
  if (typeof toolChoice === 'string') return toolChoice
  return toolChoice.type === 'function' ? `force:${toolChoice.function.name}` : 'unknown'
}

/**
 * Discovers the models the operator's server serves and publishes them to the
 * providers store. Returns `undefined` when discovery is skipped or fails.
 */
export async function discoverSelfHostedModels(
  config: SelfHostedProviderConfig
): Promise<string[] | undefined> {
  const { providerId, logger } = config
  if (typeof window !== 'undefined') {
    logger.info('Skipping model discovery on the client to avoid CORS issues')
    return undefined
  }

  const baseUrl = config.getBaseUrl()?.trim()
  if (!baseUrl) {
    logger.info('Base URL not configured, skipping model discovery', {
      envVar: `${providerId.toUpperCase()}_BASE_URL`,
    })
    return undefined
  }

  try {
    const models = await listOpenAICompatibleModels({
      baseUrl,
      apiKey: config.getApiKey(),
      prefix: `${providerId}/`,
    })
    if (!models) {
      useProvidersStore.getState().setProviderModels(providerId, [])
      logger.warn('Model server is not available; the provider will be disabled')
      return undefined
    }

    useProvidersStore.getState().setProviderModels(providerId, models)
    logger.info('Discovered models', { count: models.length, models })
    return models
  } catch (error) {
    logger.warn('Model discovery failed; the provider will be disabled', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return undefined
  }
}

/** Builds the OpenAI client for the operator's server, or a validated user endpoint. */
async function createSelfHostedClient(
  request: ProviderRequest,
  config: SelfHostedProviderConfig
): Promise<OpenAI> {
  const { providerId, providerName, logger } = config
  const userProvidedEndpoint = config.allowRequestEndpoint ? request.azureEndpoint : undefined

  const baseUrl = (userProvidedEndpoint || config.getBaseUrl())?.trim()
  if (!baseUrl) {
    throw new Error(`${providerId.toUpperCase()}_BASE_URL is required for ${providerName} provider`)
  }
  const apiBaseUrl = getOpenAICompatibleApiBaseUrl(baseUrl)

  /**
   * The operator-configured base URL is trusted and left unvalidated, mirroring the
   * Azure providers. The `selfHostedService` profile is what makes a self-hosted
   * server reachable at all: over plain HTTP, which these deployments usually are,
   * and at a private address once the operator names it in the egress allowlist.
   * Anything they have not named stays blocked.
   */
  let pinnedFetch: typeof fetch | undefined
  let pinnedIP: string | undefined
  if (userProvidedEndpoint) {
    const validation = await validateUrlWithDNS(
      userProvidedEndpoint,
      `${providerName} endpoint`,
      'selfHostedService'
    )
    if (!validation.isValid) {
      logger.warn('Blocked SSRF attempt via the request endpoint', {
        endpoint: userProvidedEndpoint,
        error: validation.error,
      })
      throw new Error(`Invalid ${providerName} endpoint: ${validation.error}`)
    }
    pinnedIP = validation.resolvedIP
    pinnedFetch = createPinnedFetch(pinnedIP, { profile: 'selfHostedService' })
  }

  const apiKey = request.apiKey || config.getApiKey() || 'empty'
  return getCachedProviderClient(
    `${providerId}::${apiKey}::${apiBaseUrl}::${pinnedIP ?? 'no-pin'}`,
    () =>
      new OpenAI({
        ...openAICompatTransport(),
        apiKey,
        baseURL: apiBaseUrl,
        ...(pinnedFetch ? { fetch: pinnedFetch } : {}),
      })
  )
}

/** Runs a chat request, tool loop and settled-stream lifecycle against an operator-hosted server. */
export async function executeSelfHostedChatRequest(
  request: ProviderRequest,
  config: SelfHostedProviderConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { providerId, providerName, logger } = config

  logger.info('Preparing request', {
    model: request.model,
    hasSystemPrompt: !!request.systemPrompt,
    hasMessages: !!request.messages?.length,
    hasTools: !!request.tools?.length,
    toolCount: request.tools?.length || 0,
    hasResponseFormat: !!request.responseFormat,
    stream: !!request.stream,
  })

  const client = await createSelfHostedClient(request, config)

  const allMessages: Message[] = []

  if (request.systemPrompt) {
    allMessages.push({ role: 'system', content: request.systemPrompt })
  }

  if (request.context) {
    allMessages.push({ role: 'user', content: request.context })
  }

  if (request.messages) {
    allMessages.push(...request.messages)
  }
  const formattedMessages = formatMessagesForProvider(
    allMessages,
    providerId
  ) as ChatCompletionMessageParam[]

  const tools = request.tools?.length
    ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
    : undefined

  const payload: ChatCompletionCreateParamsNonStreaming = {
    model: request.model.replace(new RegExp(`^${providerId}/`, 'i'), ''),
    messages: formattedMessages,
  }

  if (request.temperature !== undefined) payload.temperature = request.temperature
  if (request.maxTokens != null) payload[config.maxTokensField] = request.maxTokens

  if (
    config.forwardReasoningEffort &&
    request.reasoningEffort !== undefined &&
    request.reasoningEffort !== 'auto'
  ) {
    payload.reasoning_effort = request.reasoningEffort as ReasoningEffort
  }

  let responseFormatPayload: ChatCompletionCreateParamsNonStreaming['response_format']
  if (request.responseFormat) {
    if (config.responseFormat === 'inline') {
      responseFormatPayload = buildJsonSchemaResponseFormat(request.responseFormat)
    } else {
      const isStrict = request.responseFormat.strict !== false
      const schema = request.responseFormat.schema || request.responseFormat
      responseFormatPayload = {
        type: 'json_schema',
        json_schema: {
          name: request.responseFormat.name || 'response_schema',
          schema: isStrict ? enforceStrictSchema(schema) : schema,
          strict: isStrict,
        },
      }
    }
  }

  let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
  let hasActiveTools = false

  if (tools?.length) {
    preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, providerId)
    const { tools: filteredTools, toolChoice } = preparedTools

    if (filteredTools?.length && toolChoice) {
      const activeToolChoice = toolChoice as ChatCompletionToolChoiceOption
      payload.tools = filteredTools
      payload.tool_choice = activeToolChoice
      hasActiveTools = true

      logger.info('Request configuration', {
        toolCount: filteredTools.length,
        toolChoice: describeToolChoice(activeToolChoice),
        model: payload.model,
      })
    }
  }

  const deferResponseFormat =
    config.responseFormat === 'strict-deferred' && !!responseFormatPayload && hasActiveTools
  if (responseFormatPayload && !deferResponseFormat) {
    payload.response_format = responseFormatPayload
    logger.info('Added JSON schema response format to request')
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) {
      logger.info('Using streaming response')

      const streamingParams: ChatCompletionCreateParamsStreaming = {
        ...payload,
        stream: true,
        stream_options: { include_usage: true },
      }
      const streamResponse = await client.chat.completions.create(
        await prepareConversationGeneration(request, 'chat-completions', streamingParams),
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )

      return createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: { kind: 'simple', segmentName: request.model },
        initialTokens: { input: 0, output: 0, total: 0 },
        initialCost: { input: 0, output: 0, total: 0 },
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createOpenAICompatibleAgentEventStream(streamResponse, {
            providerName,
            request,
            onComplete: ({ content, usage }) => {
              output.content =
                content && request.responseFormat ? stripJsonFences(content) : content
              const streamUsage = createChatCompletionUsageMeter(request.model)
              streamUsage.record(usage)
              output.tokens = { ...streamUsage.tokens }
              output.cost = streamUsage.cost()

              finalizeTiming()
            },
          }),
      })
    }

    const initialCallTime = Date.now()

    const originalToolChoice = payload.tool_choice

    const forcedTools = preparedTools?.forcedTools || []
    let usedForcedTools: string[] = []
    let hasUsedForcedTool = false

    let currentResponse = await client.chat.completions.create(
      await prepareConversationGeneration(request, 'chat-completions', payload),
      request.abortSignal ? { signal: request.abortSignal } : undefined
    )
    if (!currentResponse.choices[0]?.message?.tool_calls?.length) {
      await captureProviderConversationStep(
        request,
        'chat-completions',
        currentResponse.choices[0]?.message,
        getChatCompletionConversationUsage(currentResponse.usage)
      )
    }
    const firstResponseTime = Date.now() - initialCallTime

    let content = currentResponse.choices[0]?.message?.content || ''

    if (content && request.responseFormat) {
      content = stripJsonFences(content)
    }

    const usageMeter = createChatCompletionUsageMeter(request.model)
    usageMeter.record(currentResponse.usage)
    const toolCalls: FunctionCallResponse[] = []
    const toolResults: Record<string, unknown>[] = []
    const currentMessages = [...formattedMessages]
    let iterationCount = 0

    let modelTime = firstResponseTime
    let toolsTime = 0

    const timeSegments: TimeSegment[] = [
      {
        type: 'model',
        name: request.model,
        startTime: initialCallTime,
        endTime: initialCallTime + firstResponseTime,
        duration: firstResponseTime,
      },
    ]

    if (originalToolChoice) {
      const forcedResult = checkForForcedToolUsageOpenAI(
        currentResponse,
        originalToolChoice,
        providerName,
        forcedTools,
        usedForcedTools
      )
      hasUsedForcedTool = forcedResult.hasUsedForcedTool
      usedForcedTools = forcedResult.usedForcedTools
    }

    while (iterationCount < MAX_TOOL_ITERATIONS) {
      if (currentResponse.choices[0]?.message?.content) {
        content = currentResponse.choices[0].message.content
        if (request.responseFormat) {
          content = stripJsonFences(content)
        }
      }

      const toolCallsInResponse =
        currentResponse.choices[0]?.message?.tool_calls?.filter(isFunctionToolCall)

      enrichLastModelSegmentFromChatCompletions(
        timeSegments,
        currentResponse,
        toolCallsInResponse,
        {
          model: request.model,
          provider: providerId,
        }
      )

      if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
        break
      }

      logger.info('Processing tool calls', {
        toolCallCount: toolCallsInResponse.length,
        iteration: iterationCount + 1,
      })

      const toolsStartTime = Date.now()

      await captureProviderConversationStep(
        request,
        'chat-completions',
        currentResponse.choices[0]?.message,
        getChatCompletionConversationUsage(currentResponse.usage)
      )
      const toolExecutionPromises = toolCallsInResponse.map(async (toolCall) => {
        const toolCallStartTime = Date.now()
        const toolName = toolCall.function.name

        try {
          const toolArgs = parseToolArguments(toolCall.function.arguments, toolName)
          const tool = request.tools?.find((t) => t.id === toolName)

          if (!tool) {
            await recordProviderConversationToolError(
              request,
              toolCall.id,
              toolName,
              `Tool "${toolName}" is not available`
            )
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
            { signal: request.abortSignal }
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
          await recordProviderConversationToolError(
            request,
            toolCall.id,
            toolName,
            getErrorMessage(error, 'Tool execution failed')
          )
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
      const assistantMessage = currentResponse.choices[0]?.message
      if (assistantMessage) {
        currentMessages.push(
          createOpenAICompatAssistantHistory({
            message: assistantMessage,
            toolCalls: toolCallsInResponse,
            reasoningFields: config.reasoningFields,
          })
        )
      }

      for (const executionResult of executionResults) {
        const { toolCall, toolName, toolParams, result, startTime, endTime, duration } =
          executionResult
        const modelResult =
          'modelResult' in executionResult ? (executionResult.modelResult ?? result) : result

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

        const toolMessage: ChatCompletionToolMessageParam & { name?: string } = {
          role: 'tool',
          tool_call_id: toolCall.id,
          ...(config.nameToolMessages ? { name: toolName } : {}),
          content: JSON.stringify(modelResultContent),
        }
        currentMessages.push(toolMessage)
      }

      const thisToolsTime = Date.now() - toolsStartTime
      toolsTime += thisToolsTime

      const nextPayload: ChatCompletionCreateParamsNonStreaming = {
        ...payload,
        messages: currentMessages,
      }

      if (typeof originalToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
        const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

        if (remainingTools.length > 0) {
          nextPayload.tool_choice = {
            type: 'function',
            function: { name: remainingTools[0] },
          }
          logger.info('Forcing next tool', { tool: remainingTools[0] })
        } else {
          nextPayload.tool_choice = 'auto'
          logger.info('All forced tools have been used, switching to auto tool_choice')
        }
      }

      const nextModelStartTime = Date.now()

      currentResponse = await client.chat.completions.create(
        await prepareConversationGeneration(request, 'chat-completions', nextPayload),
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      if (!currentResponse.choices[0]?.message?.tool_calls?.length) {
        await captureProviderConversationStep(
          request,
          'chat-completions',
          currentResponse.choices[0]?.message,
          getChatCompletionConversationUsage(currentResponse.usage)
        )
      }

      if (nextPayload.tool_choice && typeof nextPayload.tool_choice === 'object') {
        const forcedResult = checkForForcedToolUsageOpenAI(
          currentResponse,
          nextPayload.tool_choice,
          providerName,
          forcedTools,
          usedForcedTools
        )
        hasUsedForcedTool = forcedResult.hasUsedForcedTool
        usedForcedTools = forcedResult.usedForcedTools
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

      if (currentResponse.choices[0]?.message?.content) {
        content = currentResponse.choices[0].message.content
        if (request.responseFormat) {
          content = stripJsonFences(content)
        }
      }

      usageMeter.record(currentResponse.usage)

      iterationCount++
    }

    const hitIterationCap = iterationCount === MAX_TOOL_ITERATIONS
    if (hitIterationCap) {
      /** The capped turn's tool calls are never executed or captured, so account its usage here. */
      if (currentResponse.choices[0]?.message?.tool_calls?.length) {
        await recordProviderConversationUsage(
          request,
          getChatCompletionConversationUsage(currentResponse.usage)
        )
      }
      enrichLastModelSegmentFromChatCompletions(
        timeSegments,
        currentResponse,
        currentResponse.choices[0]?.message?.tool_calls?.filter(isFunctionToolCall),
        { model: request.model, provider: providerId }
      )
    }

    if (deferResponseFormat && responseFormatPayload) {
      /**
       * Deferred structured output is a distinct extraction step, not streaming
       * regeneration. Tools stay in the payload, disabled, for backends that require them.
       */
      logger.info('Applying deferred JSON schema extraction after tool processing')

      const finalFormatStartTime = Date.now()
      const finalPayload: ChatCompletionCreateParamsNonStreaming = {
        ...payload,
        messages: currentMessages,
        response_format: responseFormatPayload,
        tool_choice: 'none',
        parallel_tool_calls: false,
      }

      const finalResponse = await client.chat.completions.create(
        await prepareConversationGeneration(request, 'chat-completions', finalPayload),
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      if (!finalResponse.choices[0]?.message?.tool_calls?.length) {
        await captureProviderConversationStep(
          request,
          'chat-completions',
          finalResponse.choices[0]?.message,
          getChatCompletionConversationUsage(finalResponse.usage)
        )
      }

      const finalFormatEndTime = Date.now()
      timeSegments.push({
        type: 'model',
        name: request.model,
        startTime: finalFormatStartTime,
        endTime: finalFormatEndTime,
        duration: finalFormatEndTime - finalFormatStartTime,
      })
      modelTime += finalFormatEndTime - finalFormatStartTime

      const formattedContent = finalResponse.choices[0]?.message?.content
      if (formattedContent) {
        content = stripJsonFences(formattedContent)
      }
      usageMeter.record(finalResponse.usage)

      enrichLastModelSegmentFromChatCompletions(
        timeSegments,
        finalResponse,
        finalResponse.choices[0]?.message?.tool_calls?.filter(isFunctionToolCall),
        { model: request.model, provider: providerId }
      )
    } else if (
      hitIterationCap &&
      currentResponse.choices[0]?.message?.tool_calls?.filter(isFunctionToolCall)?.length
    ) {
      /**
       * The capped turn still requests tools, so make one tool-disabled call
       * to synthesize an answer from the tool results already gathered.
       */
      const { tools: _tools, tool_choice: _toolChoice, ...synthesisPayload } = payload
      const synthesisStartTime = Date.now()
      const synthesisResponse = await client.chat.completions.create(
        await prepareConversationGeneration(request, 'chat-completions', {
          ...synthesisPayload,
          messages: currentMessages,
        }),
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      if (!synthesisResponse.choices[0]?.message?.tool_calls?.length) {
        await captureProviderConversationStep(
          request,
          'chat-completions',
          synthesisResponse.choices[0]?.message,
          getChatCompletionConversationUsage(synthesisResponse.usage)
        )
      }
      const synthesisEndTime = Date.now()

      timeSegments.push({
        type: 'model',
        name: 'Final answer after tool limit',
        startTime: synthesisStartTime,
        endTime: synthesisEndTime,
        duration: synthesisEndTime - synthesisStartTime,
      })
      modelTime += synthesisEndTime - synthesisStartTime

      content = synthesisResponse.choices[0]?.message?.content || content
      if (content && request.responseFormat) {
        content = stripJsonFences(content)
      }
      usageMeter.record(synthesisResponse.usage)

      enrichLastModelSegmentFromChatCompletions(
        timeSegments,
        synthesisResponse,
        synthesisResponse.choices[0]?.message?.tool_calls?.filter(isFunctionToolCall),
        { model: request.model, provider: providerId }
      )
    }

    if (request.stream) {
      logger.info('Projecting settled response after tool processing')

      const accumulatedCost = usageMeter.cost(sumToolCosts(toolResults))

      return createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: {
          kind: 'accumulated',
          modelTime,
          toolsTime,
          firstResponseTime,
          iterations: timeSegments.filter((segment) => segment.type === 'model').length,
          timeSegments,
        },
        initialTokens: { ...usageMeter.tokens },
        initialCost: accumulatedCost,
        toolCalls: toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) => {
          output.content = content
          finalizeTiming()
          return createSettledAgentEventStream(content)
        },
      })
    }

    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    return {
      content,
      model: request.model,
      tokens: { ...usageMeter.tokens },
      cost: usageMeter.cost(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      timing: {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
        modelTime: modelTime,
        toolsTime: toolsTime,
        firstResponseTime: firstResponseTime,
        iterations: timeSegments.filter((segment) => segment.type === 'model').length,
        timeSegments: timeSegments,
      },
    }
  } catch (error) {
    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    let errorMessage = toError(error).message
    let errorType: string | undefined
    let errorCode: string | number | undefined

    const envelope = isRecordLike(error) && isRecordLike(error.error) ? error.error : undefined
    if (envelope) {
      if (typeof envelope.message === 'string' && envelope.message) {
        errorMessage = envelope.message
      }
      if (typeof envelope.type === 'string') errorType = envelope.type
      if (typeof envelope.code === 'string' || typeof envelope.code === 'number') {
        errorCode = envelope.code
      }
    }

    logger[providerFailureLogLevel(error, request.abortSignal)]('Provider request failed', {
      error: errorMessage,
      errorType,
      errorCode,
      duration: totalDuration,
    })

    if (isAbortError(error) || request.abortSignal?.aborted || isConversationContextError(error)) {
      throw error
    }

    throw new ProviderError(errorMessage, {
      startTime: providerStartTimeISO,
      endTime: providerEndTimeISO,
      duration: totalDuration,
    })
  }
}
