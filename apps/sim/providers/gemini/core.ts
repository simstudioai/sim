import {
  type Content,
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type GoogleGenAI,
  type Interactions,
  type Part,
  type Schema,
  type ThinkingConfig,
  type ToolConfig,
} from '@google/genai'
import { createLogger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  checkForForcedToolUsage,
  cleanSchemaForGemini,
  convertToGeminiFormat,
  convertUsageMetadata,
  createReadableStreamFromGeminiStream,
  ensureStructResponse,
  extractAllFunctionCallParts,
  extractTextContent,
  mapToThinkingLevel,
} from '@/providers/google/utils'
import type { FunctionCallResponse, ProviderRequest, ProviderResponse } from '@/providers/types'
import {
  calculateCost,
  isDeepResearchModel,
  prepareToolExecution,
  prepareToolsWithUsageControl,
} from '@/providers/utils'
import { executeTool } from '@/tools'
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
  const initialCost = calculateCost(
    model,
    initialUsage.promptTokenCount,
    initialUsage.candidatesTokenCount
  )

  return {
    contents,
    tokens: {
      input: initialUsage.promptTokenCount,
      output: initialUsage.candidatesTokenCount,
      total: initialUsage.totalTokenCount,
    },
    cost: initialCost,
    toolCalls: [],
    toolResults: [],
    iterationCount: 0,
    modelTime: firstResponseTime,
    toolsTime: 0,
    timeSegments: [
      {
        type: 'model',
        name: 'Initial response',
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
  logger: ReturnType<typeof createLogger>
): Promise<{ success: boolean; state: ExecutionState }> {
  if (functionCallParts.length === 0) {
    return { success: false, state }
  }

  const executionPromises = functionCallParts.map(async (part) => {
    const toolCallStartTime = Date.now()
    const functionCall = part.functionCall!
    const toolName = functionCall.name ?? ''
    const args = (functionCall.args ?? {}) as Record<string, unknown>

    const tool = request.tools?.find((t) => t.id === toolName)
    if (!tool) {
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
      const { toolParams, executionParams } = prepareToolExecution(tool, args, request)
      const result = await executeTool(toolName, executionParams)
      const toolCallEndTime = Date.now()
      const duration = toolCallEndTime - toolCallStartTime

      const resultContent: Record<string, unknown> = result.success
        ? ensureStructResponse(result.output)
        : { error: true, message: result.error || 'Tool execution failed', tool: toolName }

      return {
        success: result.success,
        part,
        toolName,
        args,
        resultContent,
        toolParams,
        result,
        startTime: toolCallStartTime,
        endTime: toolCallEndTime,
        duration,
      }
    } catch (error) {
      const toolCallEndTime = Date.now()
      logger.error('Error processing function call:', {
        error: error instanceof Error ? error.message : String(error),
        functionName: toolName,
      })
      return {
        success: false,
        part,
        toolName,
        args,
        resultContent: {
          error: true,
          message: error instanceof Error ? error.message : 'Tool execution failed',
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
  const modelParts: Part[] = results.map((r) => r.part)
  const userParts: Part[] = results.map((r) => ({
    functionResponse: {
      name: r.toolName,
      response: r.resultContent,
    },
  }))

  const updatedContents: Content[] = [
    ...state.contents,
    { role: 'model', parts: modelParts },
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

    if (r.success && r.result?.output) {
      newToolResults.push(r.result.output as Record<string, unknown>)
    }

    newTimeSegments.push({
      type: 'tool',
      name: r.toolName,
      startTime: r.startTime,
      endTime: r.endTime,
      duration: r.duration,
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
  const cost = calculateCost(model, usage.promptTokenCount, usage.candidatesTokenCount)
  const duration = endTime - startTime

  return {
    ...state,
    tokens: {
      input: state.tokens.input + usage.promptTokenCount,
      output: state.tokens.output + usage.candidatesTokenCount,
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
        name: `Model response (iteration ${state.iterationCount + 1})`,
        startTime,
        endTime,
        duration,
      },
    ],
    iterationCount: state.iterationCount + 1,
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
  logger: ReturnType<typeof createLogger>
): GenerateContentConfig {
  const nextConfig = { ...baseConfig }
  const allForcedToolsUsed =
    forcedTools.length > 0 && state.usedForcedTools.length === forcedTools.length

  if (allForcedToolsUsed && request.responseFormat) {
    nextConfig.tools = undefined
    nextConfig.toolConfig = undefined
    nextConfig.responseMimeType = 'application/json'
    nextConfig.responseSchema = cleanSchemaForGemini(request.responseFormat.schema) as Schema
    logger.info('Using structured output for final response after tool execution')
  } else if (state.currentToolConfig) {
    nextConfig.toolConfig = state.currentToolConfig
  } else {
    nextConfig.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }
  }

  return nextConfig
}

/**
 * Creates streaming execution result template
 */
function createStreamingResult(
  providerStartTime: number,
  providerStartTimeISO: string,
  firstResponseTime: number,
  initialCallTime: number,
  state?: ExecutionState
): StreamingExecution {
  return {
    stream: undefined as unknown as ReadableStream<Uint8Array>,
    execution: {
      success: true,
      output: {
        content: '',
        model: '',
        tokens: state?.tokens ?? { input: 0, output: 0, total: 0 },
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
          iterations: (state?.iterationCount ?? 0) + 1,
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

const DEEP_RESEARCH_POLL_INTERVAL_MS = 10_000
const DEEP_RESEARCH_MAX_DURATION_MS = 60 * 60 * 1000

/**
 * Sleeps for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Collapses a ProviderRequest into a single input string and optional system instruction
 * for the Interactions API, which takes a flat input rather than a messages array.
 *
 * Deep research is single-turn only — it takes one research query and returns a report.
 * Memory/conversation history is hidden in the UI for deep research models, so only
 * the last user message is used as input. System messages are passed via system_instruction.
 */
function collapseMessagesToInput(request: ProviderRequest): {
  input: string
  systemInstruction: string | undefined
} {
  const systemParts: string[] = []
  const userParts: string[] = []

  if (request.systemPrompt) {
    systemParts.push(request.systemPrompt)
  }

  if (request.messages) {
    for (const msg of request.messages) {
      if (msg.role === 'system' && msg.content) {
        systemParts.push(msg.content)
      } else if (msg.content) {
        userParts.push(msg.content)
      }
    }
  }

  return {
    input:
      userParts.length > 0
        ? userParts[userParts.length - 1]
        : 'Please conduct research on the provided topic.',
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
  }
}

/**
 * Extracts text content from a completed interaction's outputs array.
 * The outputs array can contain text, thought, google_search_result, and other types.
 * We concatenate all text outputs to get the full research report.
 */
function extractTextFromInteractionOutputs(outputs: Interactions.Interaction['outputs']): string {
  if (!outputs || outputs.length === 0) return ''

  const textParts: string[] = []
  for (const output of outputs) {
    if (output.type === 'text') {
      const text = (output as Interactions.TextContent).text
      if (text) textParts.push(text)
    }
  }

  return textParts.join('\n\n')
}

/**
 * Extracts token usage from an Interaction's Usage object.
 * The Interactions API provides total_input_tokens, total_output_tokens, total_tokens,
 * and total_reasoning_tokens (for thinking models).
 *
 * Also handles the raw API field name total_thought_tokens which the SDK may
 * map to total_reasoning_tokens.
 */
function extractInteractionUsage(usage: Interactions.Usage | undefined): {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
} {
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }
  }

  const usageLogger = createLogger('DeepResearchUsage')
  usageLogger.info('Raw interaction usage', { usage: JSON.stringify(usage) })

  const inputTokens = usage.total_input_tokens ?? 0
  const outputTokens = usage.total_output_tokens ?? 0
  const reasoningTokens =
    usage.total_reasoning_tokens ??
    ((usage as Record<string, unknown>).total_thought_tokens as number) ??
    0
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens

  return { inputTokens, outputTokens, reasoningTokens, totalTokens }
}

/**
 * Builds a standard ProviderResponse from a completed deep research interaction.
 */
function buildDeepResearchResponse(
  content: string,
  model: string,
  usage: {
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    totalTokens: number
  },
  providerStartTime: number,
  providerStartTimeISO: string,
  interactionId?: string
): ProviderResponse {
  const providerEndTime = Date.now()
  const duration = providerEndTime - providerStartTime

  return {
    content,
    model,
    tokens: {
      input: usage.inputTokens,
      output: usage.outputTokens,
      total: usage.totalTokens,
    },
    timing: {
      startTime: providerStartTimeISO,
      endTime: new Date(providerEndTime).toISOString(),
      duration,
      modelTime: duration,
      toolsTime: 0,
      firstResponseTime: duration,
      iterations: 1,
      timeSegments: [
        {
          type: 'model',
          name: 'Deep research',
          startTime: providerStartTime,
          endTime: providerEndTime,
          duration,
        },
      ],
    },
    cost: calculateCost(model, usage.inputTokens, usage.outputTokens),
    interactionId,
  }
}

/**
 * Creates a ReadableStream from a deep research streaming interaction.
 *
 * Deep research streaming returns InteractionSSEEvent chunks including:
 * - interaction.start: initial interaction with ID
 * - content.delta: incremental text and thought_summary updates
 * - content.start / content.stop: output boundaries
 * - interaction.complete: final event (outputs is undefined in streaming; must reconstruct)
 * - error: error events
 *
 * We stream text deltas to the client and track usage from the interaction.complete event.
 */
function createDeepResearchStream(
  stream: AsyncIterable<Interactions.InteractionSSEEvent>,
  onComplete?: (
    content: string,
    usage: {
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      totalTokens: number
    },
    interactionId?: string
  ) => void
): ReadableStream<Uint8Array> {
  const streamLogger = createLogger('DeepResearchStream')
  let fullContent = ''
  let completionUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }
  let completedInteractionId: string | undefined

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.event_type === 'content.delta') {
            const delta = (event as Interactions.ContentDelta).delta
            if (delta?.type === 'text' && 'text' in delta && delta.text) {
              fullContent += delta.text
              controller.enqueue(new TextEncoder().encode(delta.text))
            }
          } else if (event.event_type === 'interaction.complete') {
            const interaction = (event as Interactions.InteractionEvent).interaction
            if (interaction?.usage) {
              completionUsage = extractInteractionUsage(interaction.usage)
            }
            completedInteractionId = interaction?.id
          } else if (event.event_type === 'interaction.start') {
            const interaction = (event as Interactions.InteractionEvent).interaction
            if (interaction?.id) {
              completedInteractionId = interaction.id
            }
          } else if (event.event_type === 'error') {
            const errorEvent = event as { error?: { code?: string; message?: string } }
            const message = errorEvent.error?.message ?? 'Unknown deep research stream error'
            streamLogger.error('Deep research stream error', {
              code: errorEvent.error?.code,
              message,
            })
            controller.error(new Error(message))
            return
          }
        }

        onComplete?.(fullContent, completionUsage, completedInteractionId)
        controller.close()
      } catch (error) {
        streamLogger.error('Error reading deep research stream', {
          error: error instanceof Error ? error.message : String(error),
        })
        controller.error(error)
      }
    },
  })
}

/**
 * Executes a deep research request using the Interactions API.
 *
 * Deep research uses the Interactions API ({@link https://ai.google.dev/api/interactions-api}),
 * a completely different surface from generateContent. It creates a background interaction
 * that performs comprehensive research (up to 60 minutes).
 *
 * Supports both streaming and non-streaming modes:
 * - Streaming: returns a StreamingExecution with a ReadableStream of text deltas
 * - Non-streaming: polls until completion and returns a ProviderResponse
 *
 * Deep research does NOT support custom function calling tools, MCP servers,
 * or structured output (response_format). These are gracefully ignored.
 */
export async function executeDeepResearchRequest(
  config: GeminiExecutionConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { ai, model, request, providerType } = config
  const logger = createLogger(providerType === 'google' ? 'GoogleProvider' : 'VertexProvider')

  logger.info('Preparing deep research request', {
    model,
    hasSystemPrompt: !!request.systemPrompt,
    hasMessages: !!request.messages?.length,
    streaming: !!request.stream,
    hasPreviousInteractionId: !!request.previousInteractionId,
  })

  if (request.tools?.length) {
    logger.warn('Deep research does not support custom tools — ignoring tools parameter')
  }
  if (request.responseFormat) {
    logger.warn(
      'Deep research does not support structured output — ignoring responseFormat parameter'
    )
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    const { input, systemInstruction } = collapseMessagesToInput(request)

    // Deep research requires background=true and store=true (store defaults to true,
    // but we set it explicitly per API requirements)
    const baseParams = {
      agent: model as Interactions.CreateAgentInteractionParamsNonStreaming['agent'],
      input,
      background: true,
      store: true,
      ...(systemInstruction && { system_instruction: systemInstruction }),
      ...(request.previousInteractionId && {
        previous_interaction_id: request.previousInteractionId,
      }),
      agent_config: {
        type: 'deep-research' as const,
        thinking_summaries: 'auto' as const,
      },
    }

    logger.info('Creating deep research interaction', {
      inputLength: input.length,
      hasSystemInstruction: !!systemInstruction,
      streaming: !!request.stream,
    })

    // Streaming mode: create a streaming interaction and return a StreamingExecution
    if (request.stream) {
      const streamParams: Interactions.CreateAgentInteractionParamsStreaming = {
        ...baseParams,
        stream: true,
      }

      const streamResponse = await ai.interactions.create(streamParams)
      const firstResponseTime = Date.now() - providerStartTime

      const streamingResult: StreamingExecution = {
        stream: undefined as unknown as ReadableStream<Uint8Array>,
        execution: {
          success: true,
          output: {
            content: '',
            model,
            tokens: { input: 0, output: 0, total: 0 },
            providerTiming: {
              startTime: providerStartTimeISO,
              endTime: new Date().toISOString(),
              duration: Date.now() - providerStartTime,
              modelTime: firstResponseTime,
              toolsTime: 0,
              firstResponseTime,
              iterations: 1,
              timeSegments: [
                {
                  type: 'model',
                  name: 'Deep research (streaming)',
                  startTime: providerStartTime,
                  endTime: providerStartTime + firstResponseTime,
                  duration: firstResponseTime,
                },
              ],
            },
            cost: {
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

      streamingResult.stream = createDeepResearchStream(
        streamResponse,
        (content, usage, streamInteractionId) => {
          streamingResult.execution.output.content = content
          streamingResult.execution.output.tokens = {
            input: usage.inputTokens,
            output: usage.outputTokens,
            total: usage.totalTokens,
          }
          streamingResult.execution.output.interactionId = streamInteractionId

          const cost = calculateCost(model, usage.inputTokens, usage.outputTokens)
          streamingResult.execution.output.cost = cost

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
        }
      )

      return streamingResult
    }

    // Non-streaming mode: create and poll
    const createParams: Interactions.CreateAgentInteractionParamsNonStreaming = {
      ...baseParams,
      stream: false,
    }

    const interaction = await ai.interactions.create(createParams)
    const interactionId = interaction.id

    logger.info('Deep research interaction created', { interactionId, status: interaction.status })

    // Poll until a terminal status
    const pollStartTime = Date.now()
    let result: Interactions.Interaction = interaction

    while (Date.now() - pollStartTime < DEEP_RESEARCH_MAX_DURATION_MS) {
      if (result.status === 'completed') {
        break
      }

      if (result.status === 'failed') {
        throw new Error(`Deep research interaction failed: ${interactionId}`)
      }

      if (result.status === 'cancelled') {
        throw new Error(`Deep research interaction was cancelled: ${interactionId}`)
      }

      logger.info('Deep research in progress, polling...', {
        interactionId,
        status: result.status,
        elapsedMs: Date.now() - pollStartTime,
      })

      await sleep(DEEP_RESEARCH_POLL_INTERVAL_MS)
      result = await ai.interactions.get(interactionId)
    }

    if (result.status !== 'completed') {
      throw new Error(
        `Deep research timed out after ${DEEP_RESEARCH_MAX_DURATION_MS / 1000}s (status: ${result.status})`
      )
    }

    const content = extractTextFromInteractionOutputs(result.outputs)
    const usage = extractInteractionUsage(result.usage)

    logger.info('Deep research completed', {
      interactionId,
      contentLength: content.length,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      durationMs: Date.now() - providerStartTime,
    })

    return buildDeepResearchResponse(
      content,
      model,
      usage,
      providerStartTime,
      providerStartTimeISO,
      interactionId
    )
  } catch (error) {
    const providerEndTime = Date.now()
    const duration = providerEndTime - providerStartTime

    logger.error('Error in deep research request:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    const enhancedError = error instanceof Error ? error : new Error(String(error))
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
 * Executes a request using the Gemini API
 *
 * This is the shared core logic for both Google and Vertex AI providers.
 * The only difference is how the GoogleGenAI client is configured.
 */
export async function executeGeminiRequest(
  config: GeminiExecutionConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { ai, model, request, providerType } = config

  // Route deep research models to the interactions API
  if (isDeepResearchModel(model)) {
    return executeDeepResearchRequest(config)
  }

  const logger = createLogger(providerType === 'google' ? 'GoogleProvider' : 'VertexProvider')

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
    const { contents, tools, systemInstruction } = convertToGeminiFormat(request)

    // Build configuration
    const geminiConfig: GenerateContentConfig = {}

    if (request.temperature !== undefined) {
      geminiConfig.temperature = request.temperature
    }
    if (request.maxTokens != null) {
      geminiConfig.maxOutputTokens = request.maxTokens
    }
    if (systemInstruction) {
      geminiConfig.systemInstruction = systemInstruction
    }

    // Handle response format (only when no tools)
    if (request.responseFormat && !tools?.length) {
      geminiConfig.responseMimeType = 'application/json'
      geminiConfig.responseSchema = cleanSchemaForGemini(request.responseFormat.schema) as Schema
      logger.info('Using Gemini native structured output format')
    } else if (request.responseFormat && tools?.length) {
      logger.warn('Gemini does not support responseFormat with tools. Structured output ignored.')
    }

    // Configure thinking only when the user explicitly selects a thinking level
    if (request.thinkingLevel && request.thinkingLevel !== 'none') {
      const thinkingConfig: ThinkingConfig = {
        includeThoughts: false,
        thinkingLevel: mapToThinkingLevel(request.thinkingLevel),
      }
      geminiConfig.thinkingConfig = thinkingConfig
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

    const initialCallTime = Date.now()
    const shouldStream = request.stream && !tools?.length

    // Streaming without tools
    if (shouldStream) {
      logger.info('Handling Gemini streaming response')

      const streamGenerator = await ai.models.generateContentStream({
        model,
        contents,
        config: geminiConfig,
      })
      const firstResponseTime = Date.now() - initialCallTime

      const streamingResult = createStreamingResult(
        providerStartTime,
        providerStartTimeISO,
        firstResponseTime,
        initialCallTime
      )
      streamingResult.execution.output.model = model

      streamingResult.stream = createReadableStreamFromGeminiStream(
        streamGenerator,
        (content: string, usage: GeminiUsage) => {
          streamingResult.execution.output.content = content
          streamingResult.execution.output.tokens = {
            input: usage.promptTokenCount,
            output: usage.candidatesTokenCount,
            total: usage.totalTokenCount,
          }

          const costResult = calculateCost(
            model,
            usage.promptTokenCount,
            usage.candidatesTokenCount
          )
          streamingResult.execution.output.cost = costResult

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
        }
      )

      return streamingResult
    }

    // Non-streaming request
    const response = await ai.models.generateContent({ model, contents, config: geminiConfig })
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
      model,
      toolConfig
    )
    const forcedTools = preparedTools?.forcedTools ?? []

    let currentResponse = response
    let content = ''

    // Tool execution loop
    const functionCalls = response.functionCalls
    if (functionCalls?.length) {
      const functionNames = functionCalls.map((fc) => fc.name).join(', ')
      logger.info(`Received ${functionCalls.length} function call(s) from Gemini: ${functionNames}`)

      while (state.iterationCount < MAX_TOOL_ITERATIONS) {
        // Extract ALL function call parts from the response (Gemini can return multiple)
        const functionCallParts = extractAllFunctionCallParts(currentResponse.candidates?.[0])
        if (functionCallParts.length === 0) {
          content = extractTextContent(currentResponse.candidates?.[0])
          break
        }

        const callNames = functionCallParts.map((p) => p.functionCall?.name ?? 'unknown').join(', ')
        logger.info(
          `Processing ${functionCallParts.length} function call(s): ${callNames} (iteration ${state.iterationCount + 1})`
        )

        // Execute ALL function calls in this batch
        const { success, state: updatedState } = await executeToolCallsBatch(
          functionCallParts,
          request,
          state,
          forcedTools,
          logger
        )
        if (!success) {
          content = extractTextContent(currentResponse.candidates?.[0])
          break
        }

        state = { ...updatedState, iterationCount: updatedState.iterationCount + 1 }
        const nextConfig = buildNextConfig(geminiConfig, state, forcedTools, request, logger)

        // Stream final response if requested
        if (request.stream) {
          const checkResponse = await ai.models.generateContent({
            model,
            contents: state.contents,
            config: nextConfig,
          })
          state = updateStateWithResponse(state, checkResponse, model, Date.now() - 100, Date.now())

          if (checkResponse.functionCalls?.length) {
            currentResponse = checkResponse
            continue
          }

          logger.info('No more function calls, streaming final response')

          if (request.responseFormat) {
            nextConfig.tools = undefined
            nextConfig.toolConfig = undefined
            nextConfig.responseMimeType = 'application/json'
            nextConfig.responseSchema = cleanSchemaForGemini(
              request.responseFormat.schema
            ) as Schema
          }

          // Capture accumulated cost before streaming
          const accumulatedCost = {
            input: state.cost.input,
            output: state.cost.output,
            total: state.cost.total,
          }
          const accumulatedTokens = { ...state.tokens }

          const streamGenerator = await ai.models.generateContentStream({
            model,
            contents: state.contents,
            config: nextConfig,
          })

          const streamingResult = createStreamingResult(
            providerStartTime,
            providerStartTimeISO,
            firstResponseTime,
            initialCallTime,
            state
          )
          streamingResult.execution.output.model = model

          streamingResult.stream = createReadableStreamFromGeminiStream(
            streamGenerator,
            (streamContent: string, usage: GeminiUsage) => {
              streamingResult.execution.output.content = streamContent
              streamingResult.execution.output.tokens = {
                input: accumulatedTokens.input + usage.promptTokenCount,
                output: accumulatedTokens.output + usage.candidatesTokenCount,
                total: accumulatedTokens.total + usage.totalTokenCount,
              }

              const streamCost = calculateCost(
                model,
                usage.promptTokenCount,
                usage.candidatesTokenCount
              )
              streamingResult.execution.output.cost = {
                input: accumulatedCost.input + streamCost.input,
                output: accumulatedCost.output + streamCost.output,
                total: accumulatedCost.total + streamCost.total,
                pricing: streamCost.pricing,
              }

              if (streamingResult.execution.output.providerTiming) {
                streamingResult.execution.output.providerTiming.endTime = new Date().toISOString()
                streamingResult.execution.output.providerTiming.duration =
                  Date.now() - providerStartTime
              }
            }
          )

          return streamingResult
        }

        // Non-streaming: get next response
        const nextModelStartTime = Date.now()
        const nextResponse = await ai.models.generateContent({
          model,
          contents: state.contents,
          config: nextConfig,
        })
        state = updateStateWithResponse(state, nextResponse, model, nextModelStartTime, Date.now())
        currentResponse = nextResponse
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
        iterations: state.iterationCount + 1,
        timeSegments: state.timeSegments,
      },
      cost: state.cost,
    }
  } catch (error) {
    const providerEndTime = Date.now()
    const duration = providerEndTime - providerStartTime

    logger.error('Error in Gemini request:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    const enhancedError = error instanceof Error ? error : new Error(String(error))
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
