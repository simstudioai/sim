import {
  type Content,
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type GoogleGenAI,
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
  extractFunctionCallPart,
  extractTextContent,
  mapToThinkingLevel,
} from '@/providers/google/utils'
import { getThinkingCapability } from '@/providers/models'
import type { FunctionCallResponse, ProviderRequest, ProviderResponse } from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
} from '@/providers/utils'
import { executeTool } from '@/tools'
import type { ExecutionState, GeminiProviderType, GeminiUsage, ParsedFunctionCall } from './types'

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
 * Executes a tool call and updates state
 */
async function executeToolCall(
  functionCallPart: Part,
  functionCall: ParsedFunctionCall,
  request: ProviderRequest,
  state: ExecutionState,
  forcedTools: string[],
  logger: ReturnType<typeof createLogger>
): Promise<{ success: boolean; state: ExecutionState }> {
  const toolCallStartTime = Date.now()
  const toolName = functionCall.name

  const tool = request.tools?.find((t) => t.id === toolName)
  if (!tool) {
    logger.warn(`Tool ${toolName} not found in registry, skipping`)
    return { success: false, state }
  }

  try {
    const { toolParams, executionParams } = prepareToolExecution(tool, functionCall.args, request)
    const result = await executeTool(toolName, executionParams, true)
    const toolCallEndTime = Date.now()
    const duration = toolCallEndTime - toolCallStartTime

    const resultContent: Record<string, unknown> = result.success
      ? (result.output as Record<string, unknown>)
      : { error: true, message: result.error || 'Tool execution failed', tool: toolName }

    const toolCall: FunctionCallResponse = {
      name: toolName,
      arguments: toolParams,
      startTime: new Date(toolCallStartTime).toISOString(),
      endTime: new Date(toolCallEndTime).toISOString(),
      duration,
      result: resultContent,
    }

    const updatedContents: Content[] = [
      ...state.contents,
      {
        role: 'model',
        parts: [functionCallPart],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: functionCall.name,
              response: resultContent,
            },
          },
        ],
      },
    ]

    const forcedToolCheck = checkForForcedToolUsage(
      [{ name: functionCall.name, args: functionCall.args }],
      state.currentToolConfig,
      forcedTools,
      state.usedForcedTools
    )

    return {
      success: true,
      state: {
        ...state,
        contents: updatedContents,
        toolCalls: [...state.toolCalls, toolCall],
        toolResults: result.success
          ? [...state.toolResults, result.output as Record<string, unknown>]
          : state.toolResults,
        toolsTime: state.toolsTime + duration,
        timeSegments: [
          ...state.timeSegments,
          {
            type: 'tool',
            name: toolName,
            startTime: toolCallStartTime,
            endTime: toolCallEndTime,
            duration,
          },
        ],
        usedForcedTools: forcedToolCheck?.usedForcedTools ?? state.usedForcedTools,
        currentToolConfig: forcedToolCheck?.nextToolConfig ?? state.currentToolConfig,
      },
    }
  } catch (error) {
    logger.error('Error processing function call:', {
      error: error instanceof Error ? error.message : String(error),
      functionName: toolName,
    })
    return { success: false, state }
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
    if (request.maxTokens !== undefined) {
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

    // Configure thinking for models that support it
    const thinkingCapability = getThinkingCapability(model)
    if (thinkingCapability) {
      const level = request.thinkingLevel ?? thinkingCapability.default ?? 'high'
      const thinkingConfig: ThinkingConfig = {
        includeThoughts: false,
        thinkingLevel: mapToThinkingLevel(level),
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
      logger.info(`Received function call from Gemini: ${functionCalls[0].name}`)

      while (state.iterationCount < MAX_TOOL_ITERATIONS) {
        const functionCallPart = extractFunctionCallPart(currentResponse.candidates?.[0])
        if (!functionCallPart?.functionCall) {
          content = extractTextContent(currentResponse.candidates?.[0])
          break
        }

        const functionCall: ParsedFunctionCall = {
          name: functionCallPart.functionCall.name ?? '',
          args: (functionCallPart.functionCall.args ?? {}) as Record<string, unknown>,
        }

        logger.info(
          `Processing function call: ${functionCall.name} (iteration ${state.iterationCount + 1})`
        )

        const { success, state: updatedState } = await executeToolCall(
          functionCallPart,
          functionCall,
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
