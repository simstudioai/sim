import type Anthropic from '@anthropic-ai/sdk'
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Logger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  checkForForcedToolUsage,
  createReadableStreamFromAnthropicStream,
} from '@/providers/anthropic/utils'
import {
  getMaxOutputTokensForModel,
  getThinkingCapability,
  supportsNativeStructuredOutputs,
} from '@/providers/models'
import type { ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
} from '@/providers/utils'
import { executeTool } from '@/tools'

/**
 * Configuration for creating an Anthropic provider instance.
 */
export interface AnthropicProviderConfig {
  /** Provider identifier (e.g., 'anthropic', 'azure-anthropic') */
  providerId: string
  /** Human-readable label for logging */
  providerLabel: string
  /** Factory function to create the Anthropic client */
  createClient: (apiKey: string, useNativeStructuredOutputs: boolean) => Anthropic
  /** Logger instance */
  logger: Logger
}

/**
 * Custom payload type extending the SDK's base message creation params.
 * Adds fields not yet in the SDK: adaptive thinking, output_format, output_config.
 */
interface AnthropicPayload extends Omit<Anthropic.Messages.MessageStreamParams, 'thinking'> {
  thinking?: Anthropic.Messages.ThinkingConfigParam | { type: 'adaptive' }
  output_format?: { type: 'json_schema'; schema: Record<string, unknown> }
  output_config?: { effort: string }
}

/**
 * Generates prompt-based schema instructions for older models that don't support native structured outputs.
 * This is a fallback approach that adds schema requirements to the system prompt.
 */
function generateSchemaInstructions(schema: Record<string, unknown>, schemaName?: string): string {
  const name = schemaName || 'response'
  return `IMPORTANT: You must respond with a valid JSON object that conforms to the following schema.
Do not include any text before or after the JSON object. Only output the JSON.

Schema name: ${name}
JSON Schema:
${JSON.stringify(schema, null, 2)}

Your response must be valid JSON that exactly matches this schema structure.`
}

/**
 * Maps thinking level strings to budget_tokens values for Anthropic extended thinking.
 * These values are calibrated for typical use cases:
 * - low: Quick reasoning for simple tasks
 * - medium: Balanced reasoning for most tasks
 * - high: Deep reasoning for complex problems
 */
const THINKING_BUDGET_TOKENS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 32768,
}

/**
 * Checks if a model supports adaptive thinking (Opus 4.6+)
 */
function supportsAdaptiveThinking(modelId: string): boolean {
  const normalizedModel = modelId.toLowerCase()
  return normalizedModel.includes('opus-4-6') || normalizedModel.includes('opus-4.6')
}

/**
 * Builds the thinking configuration for the Anthropic API based on model capabilities and level.
 *
 * - Opus 4.6: Uses adaptive thinking with effort parameter (recommended by Anthropic)
 * - Other models: Uses budget_tokens-based extended thinking
 *
 * Returns both the thinking config and optional output_config for adaptive thinking.
 */
function buildThinkingConfig(
  modelId: string,
  thinkingLevel: string
): {
  thinking: { type: 'enabled'; budget_tokens: number } | { type: 'adaptive' }
  outputConfig?: { effort: string }
} | null {
  const capability = getThinkingCapability(modelId)
  if (!capability || !capability.levels.includes(thinkingLevel)) {
    return null
  }

  // Opus 4.6 uses adaptive thinking with effort parameter
  if (supportsAdaptiveThinking(modelId)) {
    return {
      thinking: { type: 'adaptive' },
      outputConfig: { effort: thinkingLevel },
    }
  }

  // Other models use budget_tokens-based extended thinking
  const budgetTokens = THINKING_BUDGET_TOKENS[thinkingLevel]
  if (!budgetTokens) {
    return null
  }

  return {
    thinking: {
      type: 'enabled',
      budget_tokens: budgetTokens,
    },
  }
}

/**
 * The Anthropic SDK requires streaming for non-streaming requests when max_tokens exceeds
 * this threshold, to avoid HTTP timeouts. When thinking is enabled and pushes max_tokens
 * above this limit, we use streaming internally and collect the final message.
 */
const ANTHROPIC_SDK_NON_STREAMING_MAX_TOKENS = 21333

/**
 * Creates an Anthropic message, automatically using streaming internally when max_tokens
 * exceeds the SDK's non-streaming threshold. Returns the same Message object either way.
 */
async function createMessage(
  anthropic: Anthropic,
  payload: AnthropicPayload
): Promise<Anthropic.Messages.Message> {
  if (payload.max_tokens > ANTHROPIC_SDK_NON_STREAMING_MAX_TOKENS && !payload.stream) {
    const stream = anthropic.messages.stream(payload as Anthropic.Messages.MessageStreamParams)
    return stream.finalMessage()
  }
  return anthropic.messages.create(
    payload as Anthropic.Messages.MessageCreateParamsNonStreaming
  ) as Promise<Anthropic.Messages.Message>
}

/**
 * Executes a request using the Anthropic API with full tool loop support.
 * This is the shared core implementation used by both the standard Anthropic provider
 * and the Azure Anthropic provider.
 */
export async function executeAnthropicProviderRequest(
  request: ProviderRequest,
  config: AnthropicProviderConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { logger, providerId, providerLabel } = config

  if (!request.apiKey) {
    throw new Error(`API key is required for ${providerLabel}`)
  }

  const modelId = request.model
  const useNativeStructuredOutputs = !!(
    request.responseFormat && supportsNativeStructuredOutputs(modelId)
  )

  const anthropic = config.createClient(request.apiKey, useNativeStructuredOutputs)

  const messages: Anthropic.Messages.MessageParam[] = []
  let systemPrompt = request.systemPrompt || ''

  if (request.context) {
    messages.push({
      role: 'user',
      content: request.context,
    })
  }

  if (request.messages) {
    request.messages.forEach((msg) => {
      if (msg.role === 'function') {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.name || '',
              content: msg.content || undefined,
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

  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: systemPrompt || 'Hello' }],
    })
    systemPrompt = ''
  }

  let anthropicTools: Anthropic.Messages.Tool[] | undefined = request.tools?.length
    ? request.tools.map((tool) => ({
        name: tool.id,
        description: tool.description,
        input_schema: {
          type: 'object' as const,
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      }))
    : undefined

  let toolChoice: 'none' | 'auto' | { type: 'tool'; name: string } = 'auto'
  let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

  if (anthropicTools?.length) {
    try {
      preparedTools = prepareToolsWithUsageControl(
        anthropicTools,
        request.tools,
        logger,
        providerId
      )
      const { tools: filteredTools, toolChoice: tc } = preparedTools

      if (filteredTools?.length) {
        anthropicTools = filteredTools

        if (typeof tc === 'object' && tc !== null) {
          if (tc.type === 'tool') {
            toolChoice = tc
            logger.info(`Using ${providerLabel} tool_choice format: force tool "${tc.name}"`)
          } else {
            toolChoice = 'auto'
            logger.warn(`Received non-${providerLabel} tool_choice format, defaulting to auto`)
          }
        } else if (tc === 'auto' || tc === 'none') {
          toolChoice = tc
          logger.info(`Using tool_choice mode: ${tc}`)
        } else {
          toolChoice = 'auto'
          logger.warn('Unexpected tool_choice format, defaulting to auto')
        }
      }
    } catch (error) {
      logger.error('Error in prepareToolsWithUsageControl:', { error })
      toolChoice = 'auto'
    }
  }

  const payload: AnthropicPayload = {
    model: request.model,
    messages,
    system: systemPrompt,
    max_tokens:
      Number.parseInt(String(request.maxTokens)) || getMaxOutputTokensForModel(request.model),
    temperature: Number.parseFloat(String(request.temperature ?? 0.7)),
  }

  if (request.responseFormat) {
    const schema = request.responseFormat.schema || request.responseFormat

    if (useNativeStructuredOutputs) {
      const transformedSchema = transformJSONSchema(schema)
      payload.output_format = {
        type: 'json_schema',
        schema: transformedSchema,
      }
      logger.info(`Using native structured outputs for model: ${modelId}`)
    } else {
      const schemaInstructions = generateSchemaInstructions(schema, request.responseFormat.name)
      payload.system = payload.system
        ? `${payload.system}\n\n${schemaInstructions}`
        : schemaInstructions
      logger.info(`Using prompt-based structured outputs for model: ${modelId}`)
    }
  }

  // Add extended thinking configuration if supported and requested
  // The 'none' sentinel means "disable thinking" — skip configuration entirely.
  if (request.thinkingLevel && request.thinkingLevel !== 'none') {
    const thinkingConfig = buildThinkingConfig(request.model, request.thinkingLevel)
    if (thinkingConfig) {
      payload.thinking = thinkingConfig.thinking
      if (thinkingConfig.outputConfig) {
        payload.output_config = thinkingConfig.outputConfig
      }

      // Per Anthropic docs: budget_tokens must be less than max_tokens.
      // Ensure max_tokens leaves room for both thinking and text output.
      if (
        thinkingConfig.thinking.type === 'enabled' &&
        'budget_tokens' in thinkingConfig.thinking
      ) {
        const budgetTokens = thinkingConfig.thinking.budget_tokens
        const minMaxTokens = budgetTokens + 4096
        if (payload.max_tokens < minMaxTokens) {
          const modelMax = getMaxOutputTokensForModel(request.model)
          payload.max_tokens = Math.min(minMaxTokens, modelMax)
          logger.info(
            `Adjusted max_tokens to ${payload.max_tokens} to satisfy budget_tokens (${budgetTokens}) constraint`
          )
        }
      }

      // Per Anthropic docs: thinking is not compatible with temperature or top_k modifications.
      payload.temperature = undefined

      const isAdaptive = thinkingConfig.thinking.type === 'adaptive'
      logger.info(
        `Using ${isAdaptive ? 'adaptive' : 'extended'} thinking for model: ${modelId} with ${isAdaptive ? `effort: ${request.thinkingLevel}` : `budget: ${(thinkingConfig.thinking as { budget_tokens: number }).budget_tokens}`}`
      )
    } else {
      logger.warn(
        `Thinking level "${request.thinkingLevel}" not supported for model: ${modelId}, ignoring`
      )
    }
  }

  if (anthropicTools?.length) {
    payload.tools = anthropicTools
    // Per Anthropic docs: forced tool_choice (type: "tool" or "any") is incompatible with
    // thinking. Only auto and none are supported when thinking is enabled.
    if (payload.thinking) {
      // Per Anthropic docs: only 'auto' (default) and 'none' work with thinking.
      if (toolChoice === 'none') {
        payload.tool_choice = { type: 'none' }
      }
    } else if (toolChoice === 'none') {
      payload.tool_choice = { type: 'none' }
    } else if (toolChoice !== 'auto') {
      payload.tool_choice = toolChoice
    }
  }

  const shouldStreamToolCalls = request.streamToolCalls ?? false

  if (request.stream && (!anthropicTools || anthropicTools.length === 0)) {
    logger.info(`Using streaming response for ${providerLabel} request (no tools)`)

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    const streamResponse = await anthropic.messages.create({
      ...payload,
      stream: true,
    } as Anthropic.Messages.MessageCreateParamsStreaming)

    const streamingResult = {
      stream: createReadableStreamFromAnthropicStream(
        streamResponse as AsyncIterable<RawMessageStreamEvent>,
        (content, usage) => {
          streamingResult.execution.output.content = content
          streamingResult.execution.output.tokens = {
            input: usage.input_tokens,
            output: usage.output_tokens,
            total: usage.input_tokens + usage.output_tokens,
          }

          const costResult = calculateCost(request.model, usage.input_tokens, usage.output_tokens)
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
        }
      ),
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
          cost: {
            total: 0.0,
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

    return streamingResult as StreamingExecution
  }

  if (request.stream && !shouldStreamToolCalls) {
    logger.info(
      `Using non-streaming mode for ${providerLabel} request (tool calls executed silently)`
    )

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const initialCallTime = Date.now()
      const originalToolChoice = payload.tool_choice
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      let currentResponse = await createMessage(anthropic, payload)
      const firstResponseTime = Date.now() - initialCallTime

      let content = ''

      if (Array.isArray(currentResponse.content)) {
        content = currentResponse.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n')
      }

      const tokens = {
        input: currentResponse.usage?.input_tokens || 0,
        output: currentResponse.usage?.output_tokens || 0,
        total:
          (currentResponse.usage?.input_tokens || 0) + (currentResponse.usage?.output_tokens || 0),
      }

      const toolCalls = []
      const toolResults = []
      const currentMessages = [...messages]
      let iterationCount = 0
      let hasUsedForcedTool = false
      let modelTime = firstResponseTime
      let toolsTime = 0

      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      const firstCheckResult = checkForForcedToolUsage(
        currentResponse,
        originalToolChoice,
        forcedTools,
        usedForcedTools
      )
      if (firstCheckResult) {
        hasUsedForcedTool = firstCheckResult.hasUsedForcedTool
        usedForcedTools = firstCheckResult.usedForcedTools
      }

      try {
        while (iterationCount < MAX_TOOL_ITERATIONS) {
          const textContent = currentResponse.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('\n')

          if (textContent) {
            content = textContent
          }

          const toolUses = currentResponse.content.filter((item) => item.type === 'tool_use')
          if (!toolUses || toolUses.length === 0) {
            break
          }

          const toolsStartTime = Date.now()

          const toolExecutionPromises = toolUses.map(async (toolUse) => {
            const toolCallStartTime = Date.now()
            const toolName = toolUse.name
            const toolArgs = toolUse.input as Record<string, unknown>

            try {
              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) return null

              const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
              const result = await executeTool(toolName, executionParams)
              const toolCallEndTime = Date.now()

              return {
                toolUse,
                toolName,
                toolArgs,
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
                toolUse,
                toolName,
                toolArgs,
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

          // Collect all tool_use and tool_result blocks for batching
          const toolUseBlocks: Anthropic.Messages.ToolUseBlockParam[] = []
          const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = []

          for (const settledResult of executionResults) {
            if (settledResult.status === 'rejected' || !settledResult.value) continue

            const {
              toolUse,
              toolName,
              toolArgs,
              toolParams,
              result,
              startTime,
              endTime,
              duration,
            } = settledResult.value

            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime: startTime,
              endTime: endTime,
              duration: duration,
            })

            let resultContent: unknown
            if (result.success) {
              toolResults.push(result.output)
              resultContent = result.output
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

            // Add to batched arrays using the ORIGINAL ID from Claude's response
            toolUseBlocks.push({
              type: 'tool_use',
              id: toolUse.id,
              name: toolName,
              input: toolArgs,
            })

            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(resultContent),
            })
          }

          // Per Anthropic docs: thinking blocks must be preserved in assistant messages
          // during tool use to maintain reasoning continuity.
          const thinkingBlocks = currentResponse.content.filter(
            (
              item
            ): item is
              | Anthropic.Messages.ThinkingBlock
              | Anthropic.Messages.RedactedThinkingBlock =>
              item.type === 'thinking' || item.type === 'redacted_thinking'
          )

          // Add ONE assistant message with thinking + tool_use blocks
          if (toolUseBlocks.length > 0) {
            currentMessages.push({
              role: 'assistant',
              content: [
                ...thinkingBlocks,
                ...toolUseBlocks,
              ] as Anthropic.Messages.ContentBlockParam[],
            })
          }

          // Add ONE user message with ALL tool_result blocks
          if (toolResultBlocks.length > 0) {
            currentMessages.push({
              role: 'user',
              content: toolResultBlocks as Anthropic.Messages.ContentBlockParam[],
            })
          }

          const thisToolsTime = Date.now() - toolsStartTime
          toolsTime += thisToolsTime

          const nextPayload: AnthropicPayload = {
            ...payload,
            messages: currentMessages,
          }

          // Per Anthropic docs: forced tool_choice is incompatible with thinking.
          // Only auto and none are supported when thinking is enabled.
          const thinkingEnabled = !!payload.thinking
          if (
            !thinkingEnabled &&
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
            const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

            if (remainingTools.length > 0) {
              nextPayload.tool_choice = {
                type: 'tool',
                name: remainingTools[0],
              }
              logger.info(`Forcing next tool: ${remainingTools[0]}`)
            } else {
              nextPayload.tool_choice = undefined
              logger.info('All forced tools have been used, removing tool_choice parameter')
            }
          } else if (
            !thinkingEnabled &&
            hasUsedForcedTool &&
            typeof originalToolChoice === 'object'
          ) {
            nextPayload.tool_choice = undefined
            logger.info(
              'Removing tool_choice parameter for subsequent requests after forced tool was used'
            )
          }

          const nextModelStartTime = Date.now()

          currentResponse = await createMessage(anthropic, nextPayload)

          const nextCheckResult = checkForForcedToolUsage(
            currentResponse,
            nextPayload.tool_choice,
            forcedTools,
            usedForcedTools
          )
          if (nextCheckResult) {
            hasUsedForcedTool = nextCheckResult.hasUsedForcedTool
            usedForcedTools = nextCheckResult.usedForcedTools
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

          if (currentResponse.usage) {
            tokens.input += currentResponse.usage.input_tokens || 0
            tokens.output += currentResponse.usage.output_tokens || 0
            tokens.total +=
              (currentResponse.usage.input_tokens || 0) + (currentResponse.usage.output_tokens || 0)
          }

          iterationCount++
        }
      } catch (error) {
        logger.error(`Error in ${providerLabel} request:`, { error })
        throw error
      }

      const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

      const streamingPayload = {
        ...payload,
        messages: currentMessages,
        stream: true,
        tool_choice: undefined,
      }

      const streamResponse = await anthropic.messages.create(
        streamingPayload as Anthropic.Messages.MessageCreateParamsStreaming
      )

      const streamingResult = {
        stream: createReadableStreamFromAnthropicStream(
          streamResponse as AsyncIterable<RawMessageStreamEvent>,
          (streamContent, usage) => {
            streamingResult.execution.output.content = streamContent
            streamingResult.execution.output.tokens = {
              input: tokens.input + usage.input_tokens,
              output: tokens.output + usage.output_tokens,
              total: tokens.total + usage.input_tokens + usage.output_tokens,
            }

            const streamCost = calculateCost(request.model, usage.input_tokens, usage.output_tokens)
            streamingResult.execution.output.cost = {
              input: accumulatedCost.input + streamCost.input,
              output: accumulatedCost.output + streamCost.output,
              total: accumulatedCost.total + streamCost.total,
            }

            const streamEndTime = Date.now()
            const streamEndTimeISO = new Date(streamEndTime).toISOString()

            if (streamingResult.execution.output.providerTiming) {
              streamingResult.execution.output.providerTiming.endTime = streamEndTimeISO
              streamingResult.execution.output.providerTiming.duration =
                streamEndTime - providerStartTime
            }
          }
        ),
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
          isStreaming: true,
        },
      }

      return streamingResult as StreamingExecution
    } catch (error) {
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error(`Error in ${providerLabel} request:`, {
        error,
        duration: totalDuration,
      })

      const enhancedError = new Error(error instanceof Error ? error.message : String(error))
      // @ts-ignore
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }

      throw enhancedError
    }
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    const initialCallTime = Date.now()
    const originalToolChoice = payload.tool_choice
    const forcedTools = preparedTools?.forcedTools || []
    let usedForcedTools: string[] = []

    let currentResponse = await createMessage(anthropic, payload)
    const firstResponseTime = Date.now() - initialCallTime

    let content = ''

    if (Array.isArray(currentResponse.content)) {
      content = currentResponse.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
    }

    const tokens = {
      input: currentResponse.usage?.input_tokens || 0,
      output: currentResponse.usage?.output_tokens || 0,
      total:
        (currentResponse.usage?.input_tokens || 0) + (currentResponse.usage?.output_tokens || 0),
    }

    const initialCost = calculateCost(
      request.model,
      currentResponse.usage?.input_tokens || 0,
      currentResponse.usage?.output_tokens || 0
    )
    const cost = {
      input: initialCost.input,
      output: initialCost.output,
      total: initialCost.total,
    }

    const toolCalls = []
    const toolResults = []
    const currentMessages = [...messages]
    let iterationCount = 0
    let hasUsedForcedTool = false
    let modelTime = firstResponseTime
    let toolsTime = 0

    const timeSegments: TimeSegment[] = [
      {
        type: 'model',
        name: 'Initial response',
        startTime: initialCallTime,
        endTime: initialCallTime + firstResponseTime,
        duration: firstResponseTime,
      },
    ]

    const firstCheckResult = checkForForcedToolUsage(
      currentResponse,
      originalToolChoice,
      forcedTools,
      usedForcedTools
    )
    if (firstCheckResult) {
      hasUsedForcedTool = firstCheckResult.hasUsedForcedTool
      usedForcedTools = firstCheckResult.usedForcedTools
    }

    try {
      while (iterationCount < MAX_TOOL_ITERATIONS) {
        const textContent = currentResponse.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n')

        if (textContent) {
          content = textContent
        }

        const toolUses = currentResponse.content.filter((item) => item.type === 'tool_use')
        if (!toolUses || toolUses.length === 0) {
          break
        }

        const toolsStartTime = Date.now()

        const toolExecutionPromises = toolUses.map(async (toolUse) => {
          const toolCallStartTime = Date.now()
          const toolName = toolUse.name
          const toolArgs = toolUse.input as Record<string, unknown>
          // Preserve the original tool_use ID from Claude's response
          const toolUseId = toolUse.id

          try {
            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) return null

            const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
            const result = await executeTool(toolName, executionParams, true)
            const toolCallEndTime = Date.now()

            return {
              toolUseId,
              toolName,
              toolArgs,
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
              toolUseId,
              toolName,
              toolArgs,
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

        // Collect all tool_use and tool_result blocks for batching
        const toolUseBlocks: Anthropic.Messages.ToolUseBlockParam[] = []
        const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = []

        for (const settledResult of executionResults) {
          if (settledResult.status === 'rejected' || !settledResult.value) continue

          const {
            toolUseId,
            toolName,
            toolArgs,
            toolParams,
            result,
            startTime,
            endTime,
            duration,
          } = settledResult.value

          timeSegments.push({
            type: 'tool',
            name: toolName,
            startTime: startTime,
            endTime: endTime,
            duration: duration,
          })

          let resultContent: unknown
          if (result.success) {
            toolResults.push(result.output)
            resultContent = result.output
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

          // Add to batched arrays using the ORIGINAL ID from Claude's response
          toolUseBlocks.push({
            type: 'tool_use',
            id: toolUseId,
            name: toolName,
            input: toolArgs,
          })

          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify(resultContent),
          })
        }

        // Per Anthropic docs: thinking blocks must be preserved in assistant messages
        // during tool use to maintain reasoning continuity.
        const thinkingBlocks = currentResponse.content.filter(
          (
            item
          ): item is Anthropic.Messages.ThinkingBlock | Anthropic.Messages.RedactedThinkingBlock =>
            item.type === 'thinking' || item.type === 'redacted_thinking'
        )

        // Add ONE assistant message with thinking + tool_use blocks
        if (toolUseBlocks.length > 0) {
          currentMessages.push({
            role: 'assistant',
            content: [
              ...thinkingBlocks,
              ...toolUseBlocks,
            ] as Anthropic.Messages.ContentBlockParam[],
          })
        }

        // Add ONE user message with ALL tool_result blocks
        if (toolResultBlocks.length > 0) {
          currentMessages.push({
            role: 'user',
            content: toolResultBlocks as Anthropic.Messages.ContentBlockParam[],
          })
        }

        const thisToolsTime = Date.now() - toolsStartTime
        toolsTime += thisToolsTime

        const nextPayload: AnthropicPayload = {
          ...payload,
          messages: currentMessages,
        }

        // Per Anthropic docs: forced tool_choice is incompatible with thinking.
        // Only auto and none are supported when thinking is enabled.
        const thinkingEnabled = !!payload.thinking
        if (
          !thinkingEnabled &&
          typeof originalToolChoice === 'object' &&
          hasUsedForcedTool &&
          forcedTools.length > 0
        ) {
          const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

          if (remainingTools.length > 0) {
            nextPayload.tool_choice = {
              type: 'tool',
              name: remainingTools[0],
            }
            logger.info(`Forcing next tool: ${remainingTools[0]}`)
          } else {
            nextPayload.tool_choice = undefined
            logger.info('All forced tools have been used, removing tool_choice parameter')
          }
        } else if (
          !thinkingEnabled &&
          hasUsedForcedTool &&
          typeof originalToolChoice === 'object'
        ) {
          nextPayload.tool_choice = undefined
          logger.info(
            'Removing tool_choice parameter for subsequent requests after forced tool was used'
          )
        }

        const nextModelStartTime = Date.now()

        currentResponse = await createMessage(anthropic, nextPayload)

        const nextCheckResult = checkForForcedToolUsage(
          currentResponse,
          nextPayload.tool_choice,
          forcedTools,
          usedForcedTools
        )
        if (nextCheckResult) {
          hasUsedForcedTool = nextCheckResult.hasUsedForcedTool
          usedForcedTools = nextCheckResult.usedForcedTools
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

        if (currentResponse.usage) {
          tokens.input += currentResponse.usage.input_tokens || 0
          tokens.output += currentResponse.usage.output_tokens || 0
          tokens.total +=
            (currentResponse.usage.input_tokens || 0) + (currentResponse.usage.output_tokens || 0)

          const iterationCost = calculateCost(
            request.model,
            currentResponse.usage.input_tokens || 0,
            currentResponse.usage.output_tokens || 0
          )
          cost.input += iterationCost.input
          cost.output += iterationCost.output
          cost.total += iterationCost.total
        }

        iterationCount++
      }
    } catch (error) {
      logger.error(`Error in ${providerLabel} request:`, { error })
      throw error
    }

    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    if (request.stream) {
      logger.info(`Using streaming for final ${providerLabel} response after tool processing`)

      const streamingPayload = {
        ...payload,
        messages: currentMessages,
        stream: true,
        tool_choice: undefined,
      }

      const streamResponse = await anthropic.messages.create(
        streamingPayload as Anthropic.Messages.MessageCreateParamsStreaming
      )

      const streamingResult = {
        stream: createReadableStreamFromAnthropicStream(
          streamResponse as AsyncIterable<RawMessageStreamEvent>,
          (streamContent, usage) => {
            streamingResult.execution.output.content = streamContent
            streamingResult.execution.output.tokens = {
              input: tokens.input + usage.input_tokens,
              output: tokens.output + usage.output_tokens,
              total: tokens.total + usage.input_tokens + usage.output_tokens,
            }

            const streamCost = calculateCost(request.model, usage.input_tokens, usage.output_tokens)
            streamingResult.execution.output.cost = {
              input: cost.input + streamCost.input,
              output: cost.output + streamCost.output,
              total: cost.total + streamCost.total,
            }

            const streamEndTime = Date.now()
            const streamEndTimeISO = new Date(streamEndTime).toISOString()

            if (streamingResult.execution.output.providerTiming) {
              streamingResult.execution.output.providerTiming.endTime = streamEndTimeISO
              streamingResult.execution.output.providerTiming.duration =
                streamEndTime - providerStartTime
            }
          }
        ),
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
              input: cost.input,
              output: cost.output,
              total: cost.total,
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

      return streamingResult as StreamingExecution
    }

    return {
      content,
      model: request.model,
      tokens,
      toolCalls:
        toolCalls.length > 0
          ? toolCalls.map((tc) => ({
              name: tc.name,
              arguments: tc.arguments as Record<string, unknown>,
              startTime: tc.startTime,
              endTime: tc.endTime,
              duration: tc.duration,
              result: tc.result as Record<string, unknown> | undefined,
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
    const providerEndTime = Date.now()
    const providerEndTimeISO = new Date(providerEndTime).toISOString()
    const totalDuration = providerEndTime - providerStartTime

    logger.error(`Error in ${providerLabel} request:`, {
      error,
      duration: totalDuration,
    })

    const enhancedError = new Error(error instanceof Error ? error.message : String(error))
    // @ts-ignore
    enhancedError.timing = {
      startTime: providerStartTimeISO,
      endTime: providerEndTimeISO,
      duration: totalDuration,
    }

    throw enhancedError
  }
}
