import {
  type Content,
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type GoogleGenAI,
  type Part,
  type ThinkingConfig,
  type ToolConfig,
} from '@google/genai'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { IterationToolCall, NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { prepareConversationGeneration } from '@/providers/conversation-generation'
import {
  captureProviderConversationStep,
  recordProviderConversationToolError,
} from '@/providers/conversation-history'
import { applyGeminiResponseFormat } from '@/providers/gemini/config'
import { createGeminiStreamingToolLoopStream } from '@/providers/gemini/streaming-tool-loop'
import { priceGeminiTokens, splitGeminiUsage } from '@/providers/gemini/usage'
import {
  checkForForcedToolUsage,
  convertToGeminiFormat,
  convertUsageMetadata,
  createReadableStreamFromGeminiStream,
  ensureStructResponse,
  extractAllFunctionCallParts,
  extractTextContent,
  geminiRetryDelayMs,
  mapToThinkingBudget,
  mapToThinkingLevel,
  supportsDisablingGemini25Thinking,
} from '@/providers/google/utils'
import { getModelCapabilities, getThinkingLevelsForModel, isKnownModelId } from '@/providers/models'
import { withProviderRetry } from '@/providers/retry'
import { executeProviderTool } from '@/providers/runtime-context'
import { createSettledAgentEventStream } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { isAbortError, providerFailureLogLevel } from '@/providers/streaming-tool-loop-shared'
import { ensureToolCallId } from '@/providers/tool-call-id'
import { enrichLastModelSegment } from '@/providers/trace-enrichment'
import {
  EmptyProviderInputError,
  type FunctionCallResponse,
  type ProviderRequest,
  type ProviderResponse,
  type TimeSegment,
} from '@/providers/types'
import {
  isGemini3OrLaterModel,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  sumToolCosts,
  toBareGeminiModelId,
} from '@/providers/utils'
import type { ExecutionState, GeminiProviderType, GeminiUsage } from './types'

/**
 * Creates initial execution state
 */
function createInitialState(
  contents: Content[],
  initialUsage: GeminiUsage,
  firstResponseTime: number,
  initialCallTime: number,
  model: string,
  toolConfig: ToolConfig | undefined
): ExecutionState {
  const split = splitGeminiUsage(initialUsage)

  return {
    contents,
    tokens: { ...split, total: initialUsage.totalTokenCount },
    cost: priceGeminiTokens(model, split),
    toolCalls: [],
    toolResults: [],
    iterationCount: 0,
    modelTime: firstResponseTime,
    toolsTime: 0,
    timeSegments: [
      {
        type: 'model',
        name: model,
        startTime: initialCallTime,
        endTime: initialCallTime + firstResponseTime,
        duration: firstResponseTime,
      },
    ],
    usedForcedTools: [],
    currentToolConfig: toolConfig,
  }
}

/**
 * Executes multiple tool calls in parallel and updates state.
 * Per Gemini docs, all function calls from a single response should be executed
 * together, with one model message containing all function calls and one user
 * message containing all function responses.
 */
async function executeToolCallsBatch(
  functionCallParts: Part[],
  request: ProviderRequest,
  state: ExecutionState,
  forcedTools: string[],
  logger: ReturnType<typeof createLogger>,
  assistantContent: Content
): Promise<{ success: boolean; state: ExecutionState }> {
  if (functionCallParts.length === 0) {
    return { success: false, state }
  }

  const executionPromises = functionCallParts.map(async (part) => {
    const toolCallStartTime = Date.now()
    const functionCall = part.functionCall!
    const toolName = functionCall.name ?? ''
    const args = isRecordLike(functionCall.args) ? functionCall.args : undefined

    const tool = request.tools?.find((t) => t.id === toolName)
    if (!tool) {
      await recordProviderConversationToolError(
        request,
        functionCall.id,
        toolName,
        `Tool ${toolName} not found`
      )
      logger.warn(`Tool ${toolName} not found in registry, skipping`)
      return {
        success: false,
        part,
        toolName,
        args,
        resultContent: { error: true, message: `Tool ${toolName} not found`, tool: toolName },
        toolParams: {},
        startTime: toolCallStartTime,
        endTime: Date.now(),
        duration: Date.now() - toolCallStartTime,
      }
    }

    try {
      if (!args) {
        throw new Error(`Arguments for tool "${toolName}" must be an object`)
      }

      /*
       * The RAW model id, not a synthesized one. Gemini often omits an id on a
       * function-call part, in which case this is `undefined` and the keyed
       * helper falls back loudly rather than deriving a token from something —
       * a positional index, an execution-local id — that would look stable and
       * not be.
       */
      const { toolParams, executionParams } = prepareToolExecution(
        tool,
        args,
        request,
        part.functionCall?.id
      )
      const { rawResponse, modelResponse } = await executeProviderTool(toolName, executionParams, {
        signal: request.abortSignal,
      })
      const toolCallEndTime = Date.now()
      const duration = toolCallEndTime - toolCallStartTime

      const resultContent: Record<string, unknown> = rawResponse.success
        ? ensureStructResponse(rawResponse.output)
        : { error: true, message: rawResponse.error || 'Tool execution failed', tool: toolName }
      const modelResultContent: Record<string, unknown> = modelResponse.success
        ? ensureStructResponse(modelResponse.output)
        : { error: true, message: modelResponse.error || 'Tool execution failed', tool: toolName }

      return {
        success: rawResponse.success,
        part,
        toolName,
        args,
        resultContent,
        modelResultContent,
        toolParams,
        result: rawResponse,
        startTime: toolCallStartTime,
        endTime: toolCallEndTime,
        duration,
      }
    } catch (error) {
      if (isAbortError(error) || request.abortSignal?.aborted) {
        throw error
      }
      await recordProviderConversationToolError(
        request,
        functionCall.id,
        toolName,
        getErrorMessage(error, 'Tool execution failed')
      )

      const toolCallEndTime = Date.now()
      logger.error('Error processing function call:', {
        error: toError(error).message,
        functionName: toolName,
      })
      return {
        success: false,
        part,
        toolName,
        args: args ?? {},
        resultContent: {
          error: true,
          message: getErrorMessage(error, 'Tool execution failed'),
          tool: toolName,
        },
        toolParams: {},
        startTime: toolCallStartTime,
        endTime: toolCallEndTime,
        duration: toolCallEndTime - toolCallStartTime,
      }
    }
  })

  const results = await Promise.all(executionPromises)

  // Check if at least one tool was found (not all failed due to missing tools)
  const hasValidResults = results.some((r) => r.result !== undefined)
  if (!hasValidResults && results.every((r) => !r.success)) {
    return { success: false, state }
  }

  // Build batched messages per Gemini spec:
  // ONE model message with ALL function call parts
  // ONE user message with ALL function responses
  const userParts: Part[] = results.map((r) => ({
    functionResponse: {
      name: r.toolName,
      response: 'modelResultContent' in r ? r.modelResultContent : r.resultContent,
      ...(r.part.functionCall?.id ? { id: r.part.functionCall.id } : {}),
    },
  }))

  const updatedContents: Content[] = [
    ...state.contents,
    assistantContent,
    { role: 'user', parts: userParts },
  ]

  // Collect all tool calls and results
  const newToolCalls: FunctionCallResponse[] = []
  const newToolResults: Record<string, unknown>[] = []
  const newTimeSegments: ExecutionState['timeSegments'] = []
  let totalToolsTime = 0

  for (const r of results) {
    newToolCalls.push({
      name: r.toolName,
      arguments: r.toolParams,
      startTime: new Date(r.startTime).toISOString(),
      endTime: new Date(r.endTime).toISOString(),
      duration: r.duration,
      result: r.resultContent,
    })

    if (r.success && isRecordLike(r.result?.output)) {
      newToolResults.push(r.result.output)
    }

    newTimeSegments.push({
      type: 'tool',
      name: r.toolName,
      startTime: r.startTime,
      endTime: r.endTime,
      duration: r.duration,
      toolCallId: ensureToolCallId(r.part.functionCall?.id, 'gemini'),
    })

    totalToolsTime += r.duration
  }

  // Check forced tool usage for all executed tools
  const executedToolsInfo = results.map((r) => ({ name: r.toolName, args: r.args }))
  const forcedToolCheck = checkForForcedToolUsage(
    executedToolsInfo,
    state.currentToolConfig,
    forcedTools,
    state.usedForcedTools
  )

  return {
    success: true,
    state: {
      ...state,
      contents: updatedContents,
      toolCalls: [...state.toolCalls, ...newToolCalls],
      toolResults: [...state.toolResults, ...newToolResults],
      toolsTime: state.toolsTime + totalToolsTime,
      timeSegments: [...state.timeSegments, ...newTimeSegments],
      usedForcedTools: forcedToolCheck?.usedForcedTools ?? state.usedForcedTools,
      currentToolConfig: forcedToolCheck?.nextToolConfig ?? state.currentToolConfig,
    },
  }
}

/**
 * Updates state with model response metadata
 */
function updateStateWithResponse(
  state: ExecutionState,
  response: GenerateContentResponse,
  model: string,
  startTime: number,
  endTime: number
): ExecutionState {
  const usage = convertUsageMetadata(response.usageMetadata)
  const split = splitGeminiUsage(usage)
  const cost = priceGeminiTokens(model, split)
  const duration = endTime - startTime

  return {
    ...state,
    tokens: {
      input: state.tokens.input + split.input,
      output: state.tokens.output + split.output,
      cacheRead: state.tokens.cacheRead + split.cacheRead,
      total: state.tokens.total + usage.totalTokenCount,
    },
    cost: {
      input: state.cost.input + cost.input,
      output: state.cost.output + cost.output,
      total: state.cost.total + cost.total,
      pricing: cost.pricing, // Use latest pricing
    },
    modelTime: state.modelTime + duration,
    timeSegments: [
      ...state.timeSegments,
      {
        type: 'model',
        name: model,
        startTime,
        endTime,
        duration,
      },
    ],
  }
}

/**
 * Builds config for next iteration
 */
function buildNextConfig(
  baseConfig: GenerateContentConfig,
  state: ExecutionState,
  forcedTools: string[],
  request: ProviderRequest,
  logger: ReturnType<typeof createLogger>,
  model: string
): GenerateContentConfig {
  const nextConfig = { ...baseConfig }
  const allForcedToolsUsed =
    forcedTools.length > 0 && state.usedForcedTools.length === forcedTools.length

  if (allForcedToolsUsed && request.responseFormat) {
    nextConfig.tools = undefined
    nextConfig.toolConfig = undefined
    logger.info('Using structured output for final response after tool execution')
  } else if (state.currentToolConfig) {
    nextConfig.toolConfig = state.currentToolConfig
  } else {
    nextConfig.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }
  }

  applyGeminiResponseFormat(nextConfig, request.responseFormat, model)
  return nextConfig
}

/**
 * Creates streaming execution result template
 */
type StreamingExecutionDraft = Omit<StreamingExecution, 'stream'>

function createStreamingResult(
  providerStartTime: number,
  providerStartTimeISO: string,
  firstResponseTime: number,
  initialCallTime: number,
  state?: ExecutionState
): StreamingExecutionDraft {
  return {
    execution: {
      success: true,
      output: {
        content: '',
        model: '',
        tokens: state?.tokens ?? { input: 0, output: 0, cacheRead: 0, total: 0 },
        toolCalls: state?.toolCalls.length
          ? { list: state.toolCalls, count: state.toolCalls.length }
          : undefined,
        toolResults: state?.toolResults,
        providerTiming: {
          startTime: providerStartTimeISO,
          endTime: new Date().toISOString(),
          duration: Date.now() - providerStartTime,
          modelTime: state?.modelTime ?? firstResponseTime,
          toolsTime: state?.toolsTime ?? 0,
          firstResponseTime,
          iterations: state
            ? state.timeSegments.filter((segment) => segment.type === 'model').length
            : 1,
          timeSegments: state?.timeSegments ?? [
            {
              type: 'model',
              name: 'Initial streaming response',
              startTime: initialCallTime,
              endTime: initialCallTime + firstResponseTime,
              duration: firstResponseTime,
            },
          ],
        },
        cost: state?.cost ?? {
          input: 0,
          output: 0,
          total: 0,
          pricing: { input: 0, output: 0, updatedAt: new Date().toISOString() },
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
}

/**
 * Configuration for executing a Gemini request
 */
export interface GeminiExecutionConfig {
  ai: GoogleGenAI
  model: string
  request: ProviderRequest
  providerType: GeminiProviderType
}

/**
 * Executes a request using the Gemini API
 *
 * This is the shared core logic for both Google and Vertex AI providers.
 * The only difference is how the GoogleGenAI client is configured.
 */
export async function executeGeminiRequest(
  config: GeminiExecutionConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { ai, model, request, providerType } = config

  const logger = createLogger(providerType === 'google' ? 'GoogleProvider' : 'VertexProvider')
  const retryOptions = {
    logger,
    label: providerType === 'google' ? 'Gemini' : 'Vertex AI',
    abortSignal: request.abortSignal,
    retryAfterMs: geminiRetryDelayMs,
  }

  logger.info(`Preparing ${providerType} Gemini request`, {
    model,
    hasSystemPrompt: !!request.systemPrompt,
    hasMessages: !!request.messages?.length,
    hasTools: !!request.tools?.length,
    toolCount: request.tools?.length ?? 0,
    hasResponseFormat: !!request.responseFormat,
    streaming: !!request.stream,
  })

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    const { contents, tools, systemInstruction } = convertToGeminiFormat(request, providerType)
    /** The SDK refuses empty `contents` with an opaque "contents are required"; a system prompt alone is not enough. */
    if (contents.length === 0) {
      throw new EmptyProviderInputError(
        'The Agent has no user message to send, and Gemini needs one alongside any system prompt. Add a user message, or check that the value it references (for example <start.input>) is not empty.'
      )
    }

    // Build configuration
    const geminiConfig: GenerateContentConfig = {}

    if (request.abortSignal) {
      geminiConfig.abortSignal = request.abortSignal
    }
    if (
      request.temperature !== undefined &&
      (!isKnownModelId(request.model) || getModelCapabilities(request.model)?.temperature)
    ) {
      geminiConfig.temperature = request.temperature
    }
    if (request.maxTokens != null) {
      geminiConfig.maxOutputTokens = request.maxTokens
    }
    if (systemInstruction) {
      geminiConfig.systemInstruction = systemInstruction
    }

    // Gemini 3 and later take thinkingLevel directly; Gemini 2.5-series rejects it and needs thinkingBudget.
    // includeThoughts is required for thought parts to appear; it is requested
    // only on agent-events runs so legacy runs keep the pre-agent-events payload.
    const isGemini3 = isGemini3OrLaterModel(model)
    // Gemini 3 has no off switch and omitting thinkingConfig means the model's default level, so
    // 'none' sends the lowest declared level (levels are listed lowest-first; MINIMAL is closest to off).
    // The catalog keys Vertex entries as vertex/<bare id>, so resource-name IDs are reduced first.
    const catalogModelId = `${providerType === 'vertex' ? 'vertex/' : ''}${toBareGeminiModelId(model)}`
    const declaredLevels = getThinkingLevelsForModel(catalogModelId)
    const requestedLevel =
      isGemini3 && request.thinkingLevel === 'none' ? declaredLevels?.[0] : request.thinkingLevel
    // A saved or variable-resolved 'xhigh' bypasses the picker; models without it reject XHIGH.
    const thinkingLevel =
      requestedLevel === 'xhigh' && !declaredLevels?.includes('xhigh') ? 'high' : requestedLevel
    if (thinkingLevel && thinkingLevel !== 'none') {
      const thinkingConfig: ThinkingConfig = { includeThoughts: request.agentEvents === true }
      if (isGemini3) {
        thinkingConfig.thinkingLevel = mapToThinkingLevel(thinkingLevel)
      } else {
        thinkingConfig.thinkingBudget = mapToThinkingBudget(model, thinkingLevel)
      }
      geminiConfig.thinkingConfig = thinkingConfig
    } else if (
      !isGemini3 &&
      request.thinkingLevel === 'none' &&
      supportsDisablingGemini25Thinking(model)
    ) {
      // Omitting thinkingConfig falls back to the API's dynamic default (ON for gemini-2.5-flash),
      // so disabling requires an explicit budget of 0.
      geminiConfig.thinkingConfig = { includeThoughts: false, thinkingBudget: 0 }
    }

    // Prepare tools
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
    let toolConfig: ToolConfig | undefined

    if (tools?.length) {
      const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))

      preparedTools = prepareToolsWithUsageControl(
        functionDeclarations,
        request.tools,
        logger,
        'google'
      )
      const { tools: filteredTools, toolConfig: preparedToolConfig } = preparedTools

      if (filteredTools?.length) {
        geminiConfig.tools = [{ functionDeclarations: filteredTools as FunctionDeclaration[] }]

        if (preparedToolConfig) {
          toolConfig = {
            functionCallingConfig: {
              mode:
                {
                  AUTO: FunctionCallingConfigMode.AUTO,
                  ANY: FunctionCallingConfigMode.ANY,
                  NONE: FunctionCallingConfigMode.NONE,
                }[preparedToolConfig.functionCallingConfig.mode] ?? FunctionCallingConfigMode.AUTO,
              allowedFunctionNames: preparedToolConfig.functionCallingConfig.allowedFunctionNames,
            },
          }
          geminiConfig.toolConfig = toolConfig
        }

        logger.info('Gemini request with tools:', {
          toolCount: filteredTools.length,
          model,
          tools: filteredTools.map((t) => (t as FunctionDeclaration).name),
        })
      }
    }

    applyGeminiResponseFormat(geminiConfig, request.responseFormat, model)

    const initialCallTime = Date.now()
    /**
     * Gemini 2 cannot combine responseSchema with tools, so structured output
     * is applied on a final schema-configured request after tools settle — the
     * silent path does this; the live loop would break as soon as a turn has
     * no calls and skip the schema. Gemini 3 and later carry responseJsonSchema
     * alongside automatic tools, or apply it after forced calls settle.
     */
    const hasActiveTools = Boolean(geminiConfig.tools?.length)
    const responseFormatNeedsFinalPass =
      Boolean(request.responseFormat) && hasActiveTools && !isGemini3
    const liveToolLoopSupported = !responseFormatNeedsFinalPass
    const shouldStream = request.stream && !hasActiveTools

    // Live streaming tool loop
    if (request.stream && liveToolLoopSupported && hasActiveTools) {
      logger.info('Using streaming tool loop for Gemini request')

      const timeSegments: TimeSegment[] = []
      const forcedTools = preparedTools?.forcedTools ?? []

      return createStreamingExecution({
        model,
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
        initialCost: { total: 0.0, input: 0.0, output: 0.0 },
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createGeminiStreamingToolLoopStream({
            ai,
            model,
            baseConfig: geminiConfig,
            contents,
            request,
            logger,
            timeSegments,
            forcedTools,
            toolConfig,
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

    // Streaming without tools
    if (shouldStream) {
      logger.info('Handling Gemini streaming response')

      const streamPayload = await prepareConversationGeneration(request, 'gemini', {
        model,
        contents,
        config: geminiConfig,
      })
      const streamGenerator = await withProviderRetry(
        () => ai.models.generateContentStream(streamPayload),
        retryOptions
      )
      const firstResponseTime = Date.now() - initialCallTime

      const streamingResult = createStreamingResult(
        providerStartTime,
        providerStartTimeISO,
        firstResponseTime,
        initialCallTime
      )
      streamingResult.execution.output.model = model

      const stream = createReadableStreamFromGeminiStream(
        streamGenerator,
        (content: string, usage: GeminiUsage, thinking?: string) => {
          const split = splitGeminiUsage(usage)

          streamingResult.execution.output.content = content
          streamingResult.execution.output.tokens = { ...split, total: usage.totalTokenCount }
          streamingResult.execution.output.cost = priceGeminiTokens(request.model, split)

          if (thinking) {
            const segment = streamingResult.execution.output.providerTiming?.timeSegments?.[0]
            if (segment) {
              segment.thinkingContent = thinking
            }
          }

          const streamEndTime = Date.now()
          if (streamingResult.execution.output.providerTiming) {
            streamingResult.execution.output.providerTiming.endTime = new Date(
              streamEndTime
            ).toISOString()
            streamingResult.execution.output.providerTiming.duration =
              streamEndTime - providerStartTime
            const segments = streamingResult.execution.output.providerTiming.timeSegments
            if (segments?.[0]) {
              segments[0].endTime = streamEndTime
              segments[0].duration = streamEndTime - providerStartTime
            }
          }
        },
        request
      )

      return { ...streamingResult, stream, streamFormat: 'agent-events-v1' as const }
    }

    // Non-streaming request
    const responsePayload = await prepareConversationGeneration(request, 'gemini', {
      model,
      contents,
      config: geminiConfig,
    })
    const response = await withProviderRetry(
      () => ai.models.generateContent(responsePayload),
      retryOptions
    )
    if (!extractAllFunctionCallParts(response.candidates?.[0]).length) {
      await captureProviderConversationStep(
        request,
        'gemini',
        response.candidates?.[0]?.content,
        splitGeminiUsage(convertUsageMetadata(response.usageMetadata))
      )
    }
    const firstResponseTime = Date.now() - initialCallTime

    // Check for UNEXPECTED_TOOL_CALL
    const candidate = response.candidates?.[0]
    if (candidate?.finishReason === 'UNEXPECTED_TOOL_CALL') {
      logger.warn('Gemini returned UNEXPECTED_TOOL_CALL - model attempted to call unknown tool')
    }

    const initialUsage = convertUsageMetadata(response.usageMetadata)
    let state = createInitialState(
      contents,
      initialUsage,
      firstResponseTime,
      initialCallTime,
      request.model,
      toolConfig
    )
    enrichLastModelSegmentFromGeminiResponse(state.timeSegments, response, {
      model: request.model,
    })
    const forcedTools = preparedTools?.forcedTools ?? []

    let currentResponse = response
    let content = ''
    const generateFinalSynthesis = async (
      currentState: ExecutionState,
      baseConfig: GenerateContentConfig
    ): Promise<{ state: ExecutionState; response: GenerateContentResponse }> => {
      const finalConfig: GenerateContentConfig = {
        ...baseConfig,
        tools: undefined,
        toolConfig: undefined,
      }
      applyGeminiResponseFormat(finalConfig, request.responseFormat, model)

      const finalStartTime = Date.now()
      const finalResponsePayload = await prepareConversationGeneration(request, 'gemini', {
        model,
        contents: currentState.contents,
        config: finalConfig,
      })
      const finalResponse = await withProviderRetry(
        () => ai.models.generateContent(finalResponsePayload),
        retryOptions
      )
      if (!extractAllFunctionCallParts(finalResponse.candidates?.[0]).length) {
        await captureProviderConversationStep(
          request,
          'gemini',
          finalResponse.candidates?.[0]?.content,
          splitGeminiUsage(convertUsageMetadata(finalResponse.usageMetadata))
        )
      }
      const finalState = updateStateWithResponse(
        currentState,
        finalResponse,
        request.model,
        finalStartTime,
        Date.now()
      )
      enrichLastModelSegmentFromGeminiResponse(finalState.timeSegments, finalResponse, {
        model: request.model,
      })
      return { state: finalState, response: finalResponse }
    }
    const createSettledStreamingResult = (
      currentState: ExecutionState,
      settledAnswer: string
    ): StreamingExecution => {
      const toolCost = sumToolCosts(currentState.toolResults)
      const streamingResult = createStreamingResult(
        providerStartTime,
        providerStartTimeISO,
        firstResponseTime,
        initialCallTime,
        currentState
      )
      streamingResult.execution.output.model = model
      streamingResult.execution.output.content = settledAnswer
      streamingResult.execution.output.cost = {
        ...currentState.cost,
        toolCost: toolCost || undefined,
        total: currentState.cost.total + toolCost,
      }

      return {
        ...streamingResult,
        stream: createSettledAgentEventStream(settledAnswer),
        streamFormat: 'agent-events-v1',
      }
    }

    // Tool execution loop
    const functionCalls = response.functionCalls
    if (functionCalls?.length) {
      const functionNames = functionCalls.map((fc) => fc.name).join(', ')
      logger.info(`Received ${functionCalls.length} function call(s) from Gemini: ${functionNames}`)

      while (true) {
        // Extract ALL function call parts from the response (Gemini can return multiple)
        const functionCallParts = extractAllFunctionCallParts(currentResponse.candidates?.[0])
        if (functionCallParts.length === 0) {
          content = extractTextContent(currentResponse.candidates?.[0])
          break
        }

        if (state.iterationCount >= MAX_TOOL_ITERATIONS) {
          logger.info('Gemini tool-batch cap reached; generating a tool-disabled final response')
          const finalConfig = buildNextConfig(
            geminiConfig,
            state,
            forcedTools,
            request,
            logger,
            model
          )
          const finalSynthesis = await generateFinalSynthesis(state, finalConfig)
          state = finalSynthesis.state
          currentResponse = finalSynthesis.response
          content = extractTextContent(finalSynthesis.response.candidates?.[0])

          if (request.stream) {
            return createSettledStreamingResult(state, content)
          }
          break
        }

        const callNames = functionCallParts.map((p) => p.functionCall?.name ?? 'unknown').join(', ')
        logger.info(
          `Processing ${functionCallParts.length} function call(s): ${callNames} (iteration ${state.iterationCount + 1})`
        )

        await captureProviderConversationStep(
          request,
          'gemini',
          currentResponse.candidates?.[0]?.content,
          splitGeminiUsage(convertUsageMetadata(currentResponse.usageMetadata))
        )
        // Execute ALL function calls in this batch
        const { success, state: updatedState } = await executeToolCallsBatch(
          functionCallParts,
          request,
          state,
          forcedTools,
          logger,
          currentResponse.candidates?.[0]?.content ?? { role: 'model', parts: functionCallParts }
        )
        if (!success) {
          content = extractTextContent(currentResponse.candidates?.[0])
          break
        }

        state = { ...updatedState, iterationCount: updatedState.iterationCount + 1 }
        const nextConfig = buildNextConfig(geminiConfig, state, forcedTools, request, logger, model)

        /** Resolve the final turn, then project its settled answer when streaming was requested. */
        const nextModelStartTime = Date.now()
        const nextResponsePayload = await prepareConversationGeneration(request, 'gemini', {
          model,
          contents: state.contents,
          config: nextConfig,
        })
        const nextResponse = await withProviderRetry(
          () => ai.models.generateContent(nextResponsePayload),
          retryOptions
        )
        if (!extractAllFunctionCallParts(nextResponse.candidates?.[0]).length) {
          await captureProviderConversationStep(
            request,
            'gemini',
            nextResponse.candidates?.[0]?.content,
            splitGeminiUsage(convertUsageMetadata(nextResponse.usageMetadata))
          )
        }
        state = updateStateWithResponse(
          state,
          nextResponse,
          request.model,
          nextModelStartTime,
          Date.now()
        )
        enrichLastModelSegmentFromGeminiResponse(state.timeSegments, nextResponse, {
          model: request.model,
        })
        currentResponse = nextResponse

        if (
          request.stream &&
          extractAllFunctionCallParts(nextResponse.candidates?.[0]).length === 0
        ) {
          let settledResponse = nextResponse
          if (responseFormatNeedsFinalPass) {
            logger.info('Generating final schema-configured Gemini response')
            const finalSynthesis = await generateFinalSynthesis(state, nextConfig)
            state = finalSynthesis.state
            settledResponse = finalSynthesis.response
          }

          const settledAnswer = extractTextContent(settledResponse.candidates?.[0])
          return createSettledStreamingResult(state, settledAnswer)
        }
      }

      if (!content) {
        content = extractTextContent(currentResponse.candidates?.[0])
      }
    } else {
      content = extractTextContent(candidate)
    }

    const providerEndTime = Date.now()

    return {
      content,
      model,
      tokens: state.tokens,
      toolCalls: state.toolCalls.length ? state.toolCalls : undefined,
      toolResults: state.toolResults.length ? state.toolResults : undefined,
      timing: {
        startTime: providerStartTimeISO,
        endTime: new Date(providerEndTime).toISOString(),
        duration: providerEndTime - providerStartTime,
        modelTime: state.modelTime,
        toolsTime: state.toolsTime,
        firstResponseTime,
        iterations: state.timeSegments.filter((segment) => segment.type === 'model').length,
        timeSegments: state.timeSegments,
      },
      cost: state.cost,
    }
  } catch (error) {
    const providerEndTime = Date.now()
    const duration = providerEndTime - providerStartTime

    logger[providerFailureLogLevel(error, request.abortSignal)]('Error in Gemini request:', {
      error: toError(error).message,
      stack: error instanceof Error ? error.stack : undefined,
    })

    if (isAbortError(error) || request.abortSignal?.aborted) {
      throw error
    }

    const enhancedError = toError(error)
    Object.assign(enhancedError, {
      timing: {
        startTime: providerStartTimeISO,
        endTime: new Date(providerEndTime).toISOString(),
        duration,
      },
    })
    throw enhancedError
  }
}

/**
 * Enriches the last model segment with per-iteration content extracted from a
 * Gemini response: assistant text, thinking (thought) parts, function calls,
 * finish reason, and token usage.
 */
function enrichLastModelSegmentFromGeminiResponse(
  timeSegments: TimeSegment[],
  response: GenerateContentResponse,
  extras?: {
    model?: string
    ttft?: number
    errorType?: string
    errorMessage?: string
  }
): void {
  const candidate = response.candidates?.[0]
  const assistantText = extractTextContent(candidate)

  const thinkingParts =
    candidate?.content?.parts?.filter((p): p is Part & { text: string } =>
      Boolean(p.text && p.thought === true)
    ) ?? []
  const thinkingContent = thinkingParts.map((p) => p.text).join('\n\n')

  const functionCallParts = extractAllFunctionCallParts(candidate)
  const toolCalls: IterationToolCall[] = functionCallParts
    .filter((p): p is Part & { functionCall: NonNullable<Part['functionCall']> } =>
      Boolean(p.functionCall)
    )
    .map((p) => ({
      id: ensureToolCallId(p.functionCall.id, 'gemini'),
      name: p.functionCall.name ?? '',
      arguments: (p.functionCall.args ?? {}) as Record<string, unknown>,
    }))

  const usage = convertUsageMetadata(response.usageMetadata)
  const split = splitGeminiUsage(usage)
  const thoughtsTokens = response.usageMetadata?.thoughtsTokenCount ?? 0

  let cost: { input: number; output: number; total: number } | undefined
  if (
    extras?.model &&
    response.usageMetadata &&
    typeof usage.promptTokenCount === 'number' &&
    typeof usage.candidatesTokenCount === 'number'
  ) {
    const full = priceGeminiTokens(extras.model, split)
    cost = { input: full.input, output: full.output, total: full.total }
  }

  enrichLastModelSegment(timeSegments, {
    assistantContent: assistantText || undefined,
    thinkingContent: thinkingContent || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: candidate?.finishReason ?? undefined,
    tokens: response.usageMetadata
      ? {
          input: usage.promptTokenCount,
          output: usage.candidatesTokenCount,
          total: usage.totalTokenCount,
          ...(split.cacheRead > 0 && { cacheRead: split.cacheRead }),
          ...(thoughtsTokens > 0 && { reasoning: thoughtsTokens }),
        }
      : undefined,
    cost,
    provider: 'google',
    ttft: extras?.ttft,
    errorType: extras?.errorType,
    errorMessage: extras?.errorMessage,
  })
}
