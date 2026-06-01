import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import OpenAI from 'openai'
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type { Message, ProviderRequest, ProviderResponse, TimeSegment } from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  calculateCost,
  generateSchemaInstructions,
  prepareToolExecution,
  sumToolCosts,
} from '@/providers/utils'
import { executeTool } from '@/tools'

/**
 * Ollama enforces JSON mode (`json_object`) but ignores `json_schema`, so
 * structured outputs use JSON mode with the schema described in-prompt. Mutates
 * `payload.response_format` and returns the messages with instructions appended.
 */
function applyJsonResponseFormat(
  payload: { response_format?: unknown },
  messages: Message[],
  responseFormat: NonNullable<ProviderRequest['responseFormat']>
): Message[] {
  payload.response_format = { type: 'json_object' }
  const schema = responseFormat.schema || responseFormat
  return [
    ...messages,
    { role: 'user', content: generateSchemaInstructions(schema, responseFormat.name) },
  ]
}

/**
 * Per-provider hooks for the shared Ollama execution logic. The self-hosted
 * `ollama` and hosted `ollama-cloud` providers differ only in client
 * construction and labels; both pass those in here.
 */
export interface OllamaCoreConfig {
  /** Provider id used for trace enrichment (`ollama`, `ollama-cloud`). */
  providerId: string
  /** Human-readable label used in log messages. */
  providerLabel: string
  /** Builds the OpenAI-compatible client (base URL + credentials per provider). */
  createClient: () => OpenAI
  createStream: (
    stream: AsyncIterable<ChatCompletionChunk>,
    onComplete?: (content: string, usage: CompletionUsage) => void
  ) => ReadableStream<Uint8Array>
  logger: Logger
}

/**
 * Shared execution logic for the Ollama-family providers, which speak the same
 * OpenAI-compatible Ollama API. Ollama ignores `tool_choice`, so tools are sent
 * as `tool_choice: 'auto'` (forced tools degrade to auto) and the final post-tool
 * call drops tools entirely rather than relying on `tool_choice: 'none'`.
 */
export async function executeOllamaProviderRequest(
  request: ProviderRequest,
  config: OllamaCoreConfig
): Promise<ProviderResponse | StreamingExecution> {
  const { providerId, providerLabel, logger } = config

  logger.info(`Preparing ${providerLabel} request`, {
    model: request.model,
    hasSystemPrompt: !!request.systemPrompt,
    hasMessages: !!request.messages?.length,
    hasTools: !!request.tools?.length,
    toolCount: request.tools?.length || 0,
    hasResponseFormat: !!request.responseFormat,
    stream: !!request.stream,
  })

  const ollama = config.createClient()

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
  const formattedMessages = formatMessagesForProvider(allMessages, providerId) as Message[]

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

  const payload: any = {
    model: request.model,
    messages: formattedMessages,
  }

  if (request.temperature !== undefined) payload.temperature = request.temperature
  if (request.maxTokens != null) payload.max_tokens = request.maxTokens

  let hasActiveTools = false
  if (tools?.length) {
    const filteredTools = tools.filter((tool) => {
      const toolId = tool.function?.name
      const toolConfig = request.tools?.find((t) => t.id === toolId)
      return toolConfig?.usageControl !== 'none'
    })

    const hasForcedTools = tools.some((tool) => {
      const toolId = tool.function?.name
      const toolConfig = request.tools?.find((t) => t.id === toolId)
      return toolConfig?.usageControl === 'force'
    })

    if (hasForcedTools) {
      logger.warn(
        `${providerLabel} does not support forced tool selection (tool_choice parameter is ignored). ` +
          'Tools marked with usageControl="force" will behave as "auto" instead.'
      )
    }

    if (filteredTools?.length) {
      payload.tools = filteredTools
      payload.tool_choice = 'auto'
      hasActiveTools = true

      logger.info(`${providerLabel} request configuration:`, {
        toolCount: filteredTools.length,
        toolChoice: 'auto',
        forcedToolsIgnored: hasForcedTools,
        model: request.model,
      })
    }
  }

  // With tools, defer structured output to the final call so JSON mode doesn't preempt tool use.
  if (request.responseFormat && !hasActiveTools) {
    payload.messages = applyJsonResponseFormat(payload, payload.messages, request.responseFormat)
    logger.info(`Added JSON response format to ${providerLabel} request`)
  }

  const providerStartTime = Date.now()
  const providerStartTimeISO = new Date(providerStartTime).toISOString()

  try {
    if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) {
      logger.info(`Using streaming response for ${providerLabel} request`)

      const streamingParams: ChatCompletionCreateParamsStreaming = {
        ...payload,
        stream: true,
        stream_options: { include_usage: true },
      }
      const streamResponse = await ollama.chat.completions.create(
        streamingParams,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )

      const streamingResult = {
        stream: config.createStream(streamResponse, (content, usage) => {
          streamingResult.execution.output.content = content

          if (content && request.responseFormat) {
            streamingResult.execution.output.content = content
              .replace(/```json\n?|\n?```/g, '')
              .trim()
          }

          streamingResult.execution.output.tokens = {
            input: usage.prompt_tokens,
            output: usage.completion_tokens,
            total: usage.total_tokens,
          }

          const costResult = calculateCost(
            request.model,
            usage.prompt_tokens,
            usage.completion_tokens
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
                  name: request.model,
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

    let currentResponse = await ollama.chat.completions.create(
      payload,
      request.abortSignal ? { signal: request.abortSignal } : undefined
    )
    const firstResponseTime = Date.now() - initialCallTime

    let content = currentResponse.choices[0]?.message?.content || ''

    if (content && request.responseFormat) {
      content = content.replace(/```json\n?|\n?```/g, '')
      content = content.trim()
    }

    const tokens = {
      input: currentResponse.usage?.prompt_tokens || 0,
      output: currentResponse.usage?.completion_tokens || 0,
      total: currentResponse.usage?.total_tokens || 0,
    }
    const toolCalls = []
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

    while (iterationCount < MAX_TOOL_ITERATIONS) {
      if (currentResponse.choices[0]?.message?.content) {
        content = currentResponse.choices[0].message.content
        if (request.responseFormat) {
          content = content.replace(/```json\n?|\n?```/g, '').trim()
        }
      }

      const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

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

      logger.info(
        `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_TOOL_ITERATIONS})`
      )

      const toolsStartTime = Date.now()

      const toolExecutionPromises = toolCallsInResponse.map(async (toolCall) => {
        const toolCallStartTime = Date.now()
        const toolName = toolCall.function.name

        try {
          const toolArgs = JSON.parse(toolCall.function.arguments)
          const tool = request.tools?.find((t) => t.id === toolName)

          if (!tool) return null

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

      currentMessages.push({
        role: 'assistant',
        content: null,
        tool_calls: toolCallsInResponse.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      })

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

        let resultContent: any
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

        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(resultContent),
        })
      }

      const thisToolsTime = Date.now() - toolsStartTime
      toolsTime += thisToolsTime

      const nextPayload = {
        ...payload,
        messages: currentMessages,
      }

      const nextModelStartTime = Date.now()

      currentResponse = await ollama.chat.completions.create(
        nextPayload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )

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
          content = content.replace(/```json\n?|\n?```/g, '').trim()
        }
      }

      if (currentResponse.usage) {
        tokens.input += currentResponse.usage.prompt_tokens || 0
        tokens.output += currentResponse.usage.completion_tokens || 0
        tokens.total += currentResponse.usage.total_tokens || 0
      }

      iterationCount++
    }

    if (iterationCount === MAX_TOOL_ITERATIONS) {
      enrichLastModelSegmentFromChatCompletions(
        timeSegments,
        currentResponse,
        currentResponse.choices[0]?.message?.tool_calls,
        { model: request.model, provider: providerId }
      )
    }

    if (request.stream) {
      logger.info(`Using streaming for final ${providerLabel} response after tool processing`)

      const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

      const { tools: _tools, tool_choice: _toolChoice, ...streamPayload } = payload

      const finalMessages = request.responseFormat
        ? applyJsonResponseFormat(streamPayload, currentMessages, request.responseFormat)
        : currentMessages

      const streamingParams: ChatCompletionCreateParamsStreaming = {
        ...streamPayload,
        messages: finalMessages,
        stream: true,
        stream_options: { include_usage: true },
      }
      const streamResponse = await ollama.chat.completions.create(
        streamingParams,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )

      const streamingResult = {
        stream: config.createStream(streamResponse, (content, usage) => {
          streamingResult.execution.output.content = content

          if (content && request.responseFormat) {
            streamingResult.execution.output.content = content
              .replace(/```json\n?|\n?```/g, '')
              .trim()
          }

          streamingResult.execution.output.tokens = {
            input: tokens.input + usage.prompt_tokens,
            output: tokens.output + usage.completion_tokens,
            total: tokens.total + usage.total_tokens,
          }

          const streamCost = calculateCost(
            request.model,
            usage.prompt_tokens,
            usage.completion_tokens
          )
          const tc = sumToolCosts(toolResults)
          streamingResult.execution.output.cost = {
            input: accumulatedCost.input + streamCost.input,
            output: accumulatedCost.output + streamCost.output,
            toolCost: tc || undefined,
            total: accumulatedCost.total + streamCost.total + tc,
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

    // Deferred structured output: one final JSON-mode call now that tools have run.
    if (request.responseFormat && hasActiveTools) {
      const finalPayload: any = { model: payload.model }
      if (payload.temperature !== undefined) finalPayload.temperature = payload.temperature
      if (payload.max_tokens !== undefined) finalPayload.max_tokens = payload.max_tokens
      finalPayload.messages = applyJsonResponseFormat(
        finalPayload,
        currentMessages,
        request.responseFormat
      )

      const finalStartTime = Date.now()
      const finalResponse = await ollama.chat.completions.create(
        finalPayload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      const finalEndTime = Date.now()

      timeSegments.push({
        type: 'model',
        name: 'Final structured response',
        startTime: finalStartTime,
        endTime: finalEndTime,
        duration: finalEndTime - finalStartTime,
      })
      modelTime += finalEndTime - finalStartTime

      if (finalResponse.choices[0]?.message?.content) {
        content = finalResponse.choices[0].message.content.replace(/```json\n?|\n?```/g, '').trim()
      }
      if (finalResponse.usage) {
        tokens.input += finalResponse.usage.prompt_tokens || 0
        tokens.output += finalResponse.usage.completion_tokens || 0
        tokens.total += finalResponse.usage.total_tokens || 0
      }

      enrichLastModelSegmentFromChatCompletions(
        timeSegments,
        finalResponse,
        finalResponse.choices[0]?.message?.tool_calls,
        { model: request.model, provider: providerId }
      )
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

    let errorMessage = getErrorMessage(error, 'Unknown error')
    let errorType: string | undefined
    let errorCode: string | undefined
    let status: number | undefined

    if (error instanceof OpenAI.APIError) {
      errorMessage = error.message
      errorType = error.type
      errorCode = error.code ?? undefined
      status = error.status
    }

    logger.error(`Error in ${providerLabel} request:`, {
      error: errorMessage,
      errorType,
      errorCode,
      status,
      duration: totalDuration,
    })

    throw new ProviderError(errorMessage, {
      startTime: providerStartTimeISO,
      endTime: providerEndTimeISO,
      duration: totalDuration,
    })
  }
}
