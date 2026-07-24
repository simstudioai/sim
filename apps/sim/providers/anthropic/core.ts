import type Anthropic from '@anthropic-ai/sdk'
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type {
  BlockTokens,
  IterationToolCall,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { createAnthropicStreamingToolLoopStream } from '@/providers/anthropic/streaming-tool-loop'
import {
  checkForForcedToolUsage,
  createReadableStreamFromAnthropicStream,
} from '@/providers/anthropic/utils'
import { buildAnthropicMessageContent } from '@/providers/attachments'
import {
  getMaxOutputTokensForModel,
  getThinkingCapability,
  supportsNativeStructuredOutputs,
  supportsTemperature,
} from '@/providers/models'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { adaptAnthropicToolSchema } from '@/providers/tool-schema-adapter'
import { enrichLastModelSegment } from '@/providers/trace-enrichment'
import type { ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  sumToolCosts,
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
 * Message params plus `output_format`: Sim's structured outputs ride the
 * anthropic-beta header with a top-level `output_format` field, which the SDK
 * does not model (it exposes the newer `output_config.format` shape instead).
 */
interface AnthropicPayload extends Anthropic.Messages.MessageStreamParams {
  output_format?: { type: 'json_schema'; schema: Record<string, unknown> }
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

/** Anthropic's documented floor for `budget_tokens` (Messages API reference: "Must be >=1024 and less than max_tokens"). */
const ANTHROPIC_MIN_BUDGET_TOKENS = 1024

/** Headroom reserved for text output above the thinking budget when computing max_tokens. */
const ANTHROPIC_THINKING_OUTPUT_HEADROOM = 4096

/**
 * Checks if a model supports adaptive thinking (thinking.type: "adaptive").
 * Fable 5 supports ONLY adaptive thinking (always on; type: "disabled" is rejected).
 * Sonnet 5 supports ONLY adaptive thinking (manual budget_tokens returns a 400 error).
 * Opus 4.8 and Opus 4.7 support ONLY adaptive thinking (no extended thinking / budget_tokens).
 * Opus 4.6 and Sonnet 4.6 support both extended and adaptive thinking — use adaptive.
 * Opus 4.5 supports effort but NOT adaptive thinking — it uses budget_tokens with type: "enabled".
 */
function supportsAdaptiveThinking(modelId: string): boolean {
  const normalizedModel = modelId.toLowerCase()
  return (
    normalizedModel.includes('fable-5') ||
    normalizedModel.includes('sonnet-5') ||
    normalizedModel.includes('opus-4-8') ||
    normalizedModel.includes('opus-4.8') ||
    normalizedModel.includes('opus-4-7') ||
    normalizedModel.includes('opus-4.7') ||
    normalizedModel.includes('opus-4-6') ||
    normalizedModel.includes('opus-4.6') ||
    normalizedModel.includes('sonnet-4-6') ||
    normalizedModel.includes('sonnet-4.6')
  )
}

/**
 * Builds the thinking configuration for the Anthropic API based on model capabilities and level.
 *
 * - Fable 5, Sonnet 5, Opus 4.8, Opus 4.7: Uses adaptive thinking only (no extended thinking support)
 * - Opus 4.6, Sonnet 4.6: Uses adaptive thinking with effort parameter
 * - Other models: Uses budget_tokens-based extended thinking
 *
 * The newest Claude generations default `thinking.display` to `omitted`
 * (empty thinking blocks, no thinking deltas). Their registry entries mark
 * `capabilities.thinking.streamed: 'summary'`, and for those models Sim opts
 * back in with `display: 'summarized'` — but only on agent-events runs, so
 * legacy runs keep the exact pre-agent-events request shape.
 *
 * Returns both the thinking config and optional output_config for adaptive thinking.
 */
export function buildThinkingConfig(
  modelId: string,
  thinkingLevel: string,
  agentEvents: boolean
): {
  thinking: Anthropic.Messages.ThinkingConfigParam
  outputConfig?: Anthropic.Messages.OutputConfig
} | null {
  const capability = getThinkingCapability(modelId)
  if (!capability || !capability.levels.includes(thinkingLevel)) {
    return null
  }

  // Models with effort support use adaptive thinking
  if (supportsAdaptiveThinking(modelId)) {
    const requestSummarizedDisplay = agentEvents && capability.streamed === 'summary'
    return {
      thinking: {
        type: 'adaptive',
        ...(requestSummarizedDisplay ? { display: 'summarized' as const } : {}),
      },
      // Levels are validated against the model's capability list above.
      outputConfig: { effort: thinkingLevel as Anthropic.Messages.OutputConfig['effort'] },
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
  payload: AnthropicPayload,
  abortSignal?: AbortSignal
): Promise<Anthropic.Messages.Message> {
  const options = abortSignal ? { signal: abortSignal } : undefined
  if (payload.max_tokens > ANTHROPIC_SDK_NON_STREAMING_MAX_TOKENS && !payload.stream) {
    const stream = anthropic.messages.stream(
      payload as Anthropic.Messages.MessageStreamParams,
      options
    )
    return stream.finalMessage()
  }
  return anthropic.messages.create(
    payload as Anthropic.Messages.MessageCreateParamsNonStreaming,
    options
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
        const content = buildAnthropicMessageContent(msg.content, msg.files, config.providerId)
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          // double-cast-allowed: shared attachment builder returns Anthropic-compatible content blocks but avoids importing SDK-only union types
          content: content as unknown as Anthropic.Messages.ContentBlockParam[],
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
    ? request.tools.map((tool) => adaptAnthropicToolSchema(tool))
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
    ...(supportsTemperature(request.model) && {
      temperature: Number.parseFloat(String(request.temperature ?? 0.7)),
    }),
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
    const thinkingConfig = buildThinkingConfig(
      request.model,
      request.thinkingLevel,
      request.agentEvents === true
    )
    if (thinkingConfig) {
      payload.thinking = thinkingConfig.thinking
      if (thinkingConfig.outputConfig) {
        payload.output_config = thinkingConfig.outputConfig
      }

      // Keep budget_tokens < max_tokens (see constants above) by shrinking the budget
      // itself when the model's output cap is too tight — clamping max_tokens alone
      // can leave budget_tokens >= max_tokens.
      if (
        thinkingConfig.thinking.type === 'enabled' &&
        'budget_tokens' in thinkingConfig.thinking
      ) {
        const modelMax = getMaxOutputTokensForModel(request.model)
        let budgetTokens = thinkingConfig.thinking.budget_tokens

        if (budgetTokens + ANTHROPIC_THINKING_OUTPUT_HEADROOM > modelMax) {
          budgetTokens = Math.max(
            ANTHROPIC_MIN_BUDGET_TOKENS,
            modelMax - ANTHROPIC_THINKING_OUTPUT_HEADROOM
          )
          thinkingConfig.thinking.budget_tokens = budgetTokens
        }

        const minMaxTokens = budgetTokens + ANTHROPIC_THINKING_OUTPUT_HEADROOM
        if (payload.max_tokens < minMaxTokens) {
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

  if (request.stream && shouldStreamToolCalls && anthropicTools && anthropicTools.length > 0) {
    logger.info(`Using streaming tool loop for ${providerLabel} request`)

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()
    const timeSegments: TimeSegment[] = []
    const forcedTools = preparedTools?.forcedTools || []

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
      initialCost: { total: 0.0, input: 0.0, output: 0.0 },
      isStreaming: true,
      streamFormat: 'agent-events-v1',
      createStream: ({ output, finalizeTiming }) =>
        createAnthropicStreamingToolLoopStream({
          anthropic,
          payload,
          request,
          messages,
          logger,
          timeSegments,
          forcedTools,
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

  if (request.stream && (!anthropicTools || anthropicTools.length === 0)) {
    logger.info(`Using streaming response for ${providerLabel} request (no tools)`)

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    const streamResponse = await anthropic.messages.create(
      {
        ...payload,
        stream: true,
      } as Anthropic.Messages.MessageCreateParamsStreaming,
      request.abortSignal ? { signal: request.abortSignal } : undefined
    )

    const streamingResult = createStreamingExecution({
      model: request.model,
      providerStartTime,
      providerStartTimeISO,
      timing: { kind: 'simple', segmentName: request.model },
      initialTokens: { input: 0, output: 0, total: 0 },
      initialCost: { total: 0.0, input: 0.0, output: 0.0 },
      isStreaming: true,
      streamFormat: 'agent-events-v1',
      createStream: ({ output, finalizeTiming }) =>
        createReadableStreamFromAnthropicStream(
          streamResponse as AsyncIterable<RawMessageStreamEvent>,
          ({ content, usage, thinking }) => {
            output.content = content
            output.tokens = {
              input: usage.input_tokens,
              output: usage.output_tokens,
              total: usage.input_tokens + usage.output_tokens,
            }

            const costResult = calculateCost(request.model, usage.input_tokens, usage.output_tokens)
            output.cost = {
              input: costResult.input,
              output: costResult.output,
              total: costResult.total,
            }

            if (thinking) {
              const segment = output.providerTiming?.timeSegments?.[0]
              if (segment) {
                segment.thinkingContent = thinking
              }
            }

            finalizeTiming()
          }
        ),
    })

    return streamingResult
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

      let currentResponse = await createMessage(anthropic, payload, request.abortSignal)
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
      const toolResults: Record<string, unknown>[] = []
      const currentMessages = [...messages]
      let iterationCount = 0
      let hasUsedForcedTool = false
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

          enrichLastModelSegmentFromAnthropicResponse(timeSegments, currentResponse, textContent, {
            model: request.model,
          })

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
              const result = await executeTool(toolName, executionParams, {
                signal: request.abortSignal,
              })
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
                  error: getErrorMessage(error, 'Tool execution failed'),
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
              toolCallId: toolUse.id,
            })

            let resultContent: unknown
            if (result.success && result.output) {
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

          currentResponse = await createMessage(anthropic, nextPayload, request.abortSignal)

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
            name: request.model,
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

        if (iterationCount === MAX_TOOL_ITERATIONS) {
          const trailingText = currentResponse.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('\n')
          enrichLastModelSegmentFromAnthropicResponse(timeSegments, currentResponse, trailingText, {
            model: request.model,
          })
        }
      } catch (error) {
        logger.error(`Error in ${providerLabel} request:`, { error })
        throw error
      }

      const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

      /**
       * The regeneration exists purely to stream the settled answer as prose —
       * streamed tool_use is never executed on this path. `tools` must stay
       * (history contains tool_use blocks) but tool choice is pinned to none;
       * with tools present and no choice, `auto` would let the model re-call.
       */
      const streamingPayload = {
        ...payload,
        messages: currentMessages,
        stream: true,
        tool_choice: payload.tools?.length ? ({ type: 'none' } as const) : undefined,
      }

      const streamResponse = await anthropic.messages.create(
        streamingPayload as Anthropic.Messages.MessageCreateParamsStreaming,
        request.abortSignal ? { signal: request.abortSignal } : undefined
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
          toolCost: undefined as number | undefined,
          total: accumulatedCost.total,
        },
        toolCalls: toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createReadableStreamFromAnthropicStream(
            streamResponse as AsyncIterable<RawMessageStreamEvent>,
            ({ content: streamContent, usage, thinking }) => {
              if (!streamContent && content) {
                logger.warn(
                  `${providerLabel} final stream produced no text; keeping tool-loop answer`
                )
              }
              output.content = streamContent || content
              output.tokens = {
                input: tokens.input + usage.input_tokens,
                output: tokens.output + usage.output_tokens,
                total: tokens.total + usage.input_tokens + usage.output_tokens,
              }

              const streamCost = calculateCost(
                request.model,
                usage.input_tokens,
                usage.output_tokens
              )
              const tc = sumToolCosts(toolResults)
              output.cost = {
                input: accumulatedCost.input + streamCost.input,
                output: accumulatedCost.output + streamCost.output,
                toolCost: tc || undefined,
                total: accumulatedCost.total + streamCost.total + tc,
              }

              if (thinking) {
                const segments = output.providerTiming?.timeSegments
                const lastModel = segments
                  ? [...segments].reverse().find((segment) => segment.type === 'model')
                  : undefined
                if (lastModel) {
                  lastModel.thinkingContent = thinking
                }
              }

              finalizeTiming()
            }
          ),
      })

      return streamingResult
    } catch (error) {
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error(`Error in ${providerLabel} request:`, {
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

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    const initialCallTime = Date.now()
    const originalToolChoice = payload.tool_choice
    const forcedTools = preparedTools?.forcedTools || []
    let usedForcedTools: string[] = []

    let currentResponse = await createMessage(anthropic, payload, request.abortSignal)
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
    const toolResults: Record<string, unknown>[] = []
    const currentMessages = [...messages]
    let iterationCount = 0
    let hasUsedForcedTool = false
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

        enrichLastModelSegmentFromAnthropicResponse(timeSegments, currentResponse, textContent, {
          model: request.model,
        })

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
            const result = await executeTool(toolName, executionParams, {
              skipPostProcess: true,
              signal: request.abortSignal,
            })
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
                error: getErrorMessage(error, 'Tool execution failed'),
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
            toolCallId: toolUseId,
          })

          let resultContent: unknown
          if (result.success && result.output) {
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

        currentResponse = await createMessage(anthropic, nextPayload, request.abortSignal)

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
          name: request.model,
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

      if (iterationCount === MAX_TOOL_ITERATIONS) {
        const trailingText = currentResponse.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n')
        enrichLastModelSegmentFromAnthropicResponse(timeSegments, currentResponse, trailingText, {
          model: request.model,
        })
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

      /** Same regeneration guard as the primary path: prose only, no re-calls. */
      const streamingPayload = {
        ...payload,
        messages: currentMessages,
        stream: true,
        tool_choice: payload.tools?.length ? ({ type: 'none' } as const) : undefined,
      }

      const streamResponse = await anthropic.messages.create(
        streamingPayload as Anthropic.Messages.MessageCreateParamsStreaming,
        request.abortSignal ? { signal: request.abortSignal } : undefined
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
          input: cost.input,
          output: cost.output,
          toolCost: undefined as number | undefined,
          total: cost.total,
        },
        toolCalls: toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createReadableStreamFromAnthropicStream(
            streamResponse as AsyncIterable<RawMessageStreamEvent>,
            ({ content: streamContent, usage, thinking }) => {
              if (!streamContent && content) {
                logger.warn(
                  `${providerLabel} final stream produced no text; keeping tool-loop answer`
                )
              }
              output.content = streamContent || content
              output.tokens = {
                input: tokens.input + usage.input_tokens,
                output: tokens.output + usage.output_tokens,
                total: tokens.total + usage.input_tokens + usage.output_tokens,
              }

              const streamCost = calculateCost(
                request.model,
                usage.input_tokens,
                usage.output_tokens
              )
              const tc2 = sumToolCosts(toolResults)
              output.cost = {
                input: cost.input + streamCost.input,
                output: cost.output + streamCost.output,
                toolCost: tc2 || undefined,
                total: cost.total + streamCost.total + tc2,
              }

              if (thinking) {
                const segments = output.providerTiming?.timeSegments
                const lastModel = segments
                  ? [...segments].reverse().find((segment) => segment.type === 'model')
                  : undefined
                if (lastModel) {
                  lastModel.thinkingContent = thinking
                }
              }

              finalizeTiming()
            }
          ),
      })

      return streamingResult
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

    throw new ProviderError(toError(error).message, {
      startTime: providerStartTimeISO,
      endTime: providerEndTimeISO,
      duration: totalDuration,
    })
  }
}

/**
 * Enriches the last model segment with content from an Anthropic `Message`:
 * assistant text, thinking/redacted_thinking blocks, tool_use calls (with IDs),
 * stop_reason, and per-iteration tokens.
 */
function enrichLastModelSegmentFromAnthropicResponse(
  timeSegments: TimeSegment[],
  response: Anthropic.Messages.Message,
  textContent: string,
  extras?: {
    model?: string
    ttft?: number
    errorType?: string
    errorMessage?: string
  }
): void {
  const thinkingBlocks = response.content.filter(
    (item): item is Anthropic.Messages.ThinkingBlock | Anthropic.Messages.RedactedThinkingBlock =>
      item.type === 'thinking' || item.type === 'redacted_thinking'
  )
  const thinkingContent = thinkingBlocks
    .map((b) => (b.type === 'thinking' ? b.thinking : '[redacted]'))
    .join('\n\n')

  const toolUseBlocks = response.content.filter(
    (item): item is Anthropic.Messages.ToolUseBlock => item.type === 'tool_use'
  )
  const toolCalls: IterationToolCall[] = toolUseBlocks.map((t) => ({
    id: t.id,
    name: t.name,
    arguments:
      t.input && typeof t.input === 'object' && !Array.isArray(t.input)
        ? (t.input as Record<string, unknown>)
        : {},
  }))

  const segmentTokens = response.usage ? buildAnthropicSegmentTokens(response.usage) : undefined

  let cost: { input: number; output: number; total: number } | undefined
  if (
    extras?.model &&
    segmentTokens &&
    typeof segmentTokens.input === 'number' &&
    typeof segmentTokens.output === 'number'
  ) {
    const useCached = (segmentTokens.cacheRead ?? 0) > 0
    const full = calculateCost(extras.model, segmentTokens.input, segmentTokens.output, useCached)
    cost = { input: full.input, output: full.output, total: full.total }
  }

  enrichLastModelSegment(timeSegments, {
    assistantContent: textContent || undefined,
    thinkingContent: thinkingContent || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: response.stop_reason ?? undefined,
    tokens: segmentTokens,
    cost,
    provider: 'anthropic',
    ttft: extras?.ttft,
    errorType: extras?.errorType,
    errorMessage: extras?.errorMessage,
  })
}

/**
 * Builds a segment token breakdown from Anthropic usage data, surfacing prompt
 * cache reads/writes separately and producing a corrected `total` that includes
 * cache_creation tokens (which Anthropic bills as input tokens but omits from
 * `input_tokens`).
 */
function buildAnthropicSegmentTokens(usage: Anthropic.Messages.Message['usage']): BlockTokens {
  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  return {
    input,
    output,
    total: input + output + cacheRead + cacheWrite,
    ...(cacheRead > 0 && { cacheRead }),
    ...(cacheWrite > 0 && { cacheWrite }),
  }
}
