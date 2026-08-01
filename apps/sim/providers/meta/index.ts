import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import OpenAI from 'openai'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import { createReadableStreamFromMetaStream } from '@/providers/meta/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { createSettledAgentEventStream } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { isAbortError, parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  sumToolCosts,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('MetaProvider')

const META_BASE_URL = 'https://api.meta.ai/v1'

export const metaProvider: ProviderConfig = {
  id: 'meta',
  name: 'Meta',
  description: "Meta's Muse Spark models via the Meta Model API (OpenAI-compatible)",
  version: '1.0.0',
  models: getProviderModels('meta'),
  defaultModel: getProviderDefaultModel('meta'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Meta')
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const meta = new OpenAI({
        apiKey: request.apiKey,
        baseURL: META_BASE_URL,
      })

      const allMessages = []

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
      const formattedMessages = formatMessagesForProvider(allMessages, 'meta')

      const tools = request.tools?.length
        ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
        : undefined

      const payload: any = {
        model: request.model,
        messages: formattedMessages,
      }

      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens != null) payload.max_completion_tokens = request.maxTokens
      if (request.reasoningEffort !== undefined && request.reasoningEffort !== 'auto') {
        payload.reasoning_effort = request.reasoningEffort
      }

      const responseFormatPayload = request.responseFormat
        ? {
            type: 'json_schema' as const,
            json_schema: {
              name: request.responseFormat.name || 'response_schema',
              schema: request.responseFormat.schema || request.responseFormat,
              strict: request.responseFormat.strict !== false,
            },
          }
        : undefined

      let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
      let hasActiveTools = false

      if (tools?.length) {
        preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openai')
        const { tools: filteredTools, toolChoice } = preparedTools

        if (filteredTools?.length && toolChoice) {
          payload.tools = filteredTools
          hasActiveTools = true

          // Meta's Chat Completions endpoint only supports tool_choice: "auto" —
          // "none", "required", and named-function choices all return HTTP 400
          // (confirmed via the official meta-model-cookbook tool-calling recipe).
          // "auto" is already the endpoint default, so we never set the field; a
          // forced tool choice degrades to auto rather than failing the request.
          if (typeof toolChoice === 'object') {
            let requestedTool: string
            if (toolChoice.type === 'function') {
              requestedTool = toolChoice.function.name
            } else if (toolChoice.type === 'tool') {
              requestedTool = toolChoice.name
            } else {
              requestedTool = toolChoice.any.name
            }
            logger.warn(
              'Meta does not support forcing a specific tool; falling back to auto tool_choice',
              { requestedTool, model: request.model }
            )
          }

          logger.info('Meta request configuration:', {
            toolCount: filteredTools.length,
            toolChoice:
              typeof toolChoice === 'string'
                ? toolChoice
                : toolChoice.type === 'function'
                  ? `force:${toolChoice.function.name}`
                  : 'unknown',
            model: request.model,
          })
        }
      }

      // Structured output and tool calling cannot be sent together — OpenAI-compatible
      // backends reject a request that carries both `response_format` and active
      // `tools`/`tool_choice`. Defer the schema until after the tool loop completes.
      const deferResponseFormat = !!responseFormatPayload && hasActiveTools
      let appliedDeferredResponseFormat = false
      if (responseFormatPayload && !deferResponseFormat) {
        payload.response_format = responseFormatPayload
      }

      if (request.stream && (!tools || tools.length === 0 || !hasActiveTools)) {
        logger.info('Using streaming response for Meta request (no tools)')

        const streamResponse = await meta.chat.completions.create(
          {
            ...payload,
            stream: true,
            stream_options: { include_usage: true },
          },
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const streamingResult = createStreamingExecution({
          model: request.model,
          providerStartTime,
          providerStartTimeISO,
          timing: { kind: 'simple', segmentName: request.model },
          initialTokens: { input: 0, output: 0, total: 0 },
          initialCost: { input: 0, output: 0, total: 0 },
          isStreaming: true,
          streamFormat: 'agent-events-v1',
          createStream: ({ output }) =>
            createReadableStreamFromMetaStream(
              // double-cast-allowed: payload is untyped so the SDK cannot resolve the streaming overload; the stream yields OpenAI ChatCompletionChunk objects
              streamResponse as unknown as AsyncIterable<ChatCompletionChunk>,
              (content, usage) => {
                output.content = content
                output.tokens = {
                  input: usage.prompt_tokens,
                  output: usage.completion_tokens,
                  total: usage.total_tokens,
                }

                const costResult = calculateCost(
                  request.model,
                  usage.prompt_tokens,
                  usage.completion_tokens
                )
                output.cost = {
                  input: costResult.input,
                  output: costResult.output,
                  total: costResult.total,
                }
              }
            ),
        })

        return streamingResult
      }

      const initialCallTime = Date.now()

      let currentResponse = await meta.chat.completions.create(
        payload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''

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

      try {
        while (iterationCount < MAX_TOOL_ITERATIONS) {
          if (currentResponse.choices[0]?.message?.content) {
            content = currentResponse.choices[0].message.content
          }

          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            currentResponse,
            toolCallsInResponse,
            { model: request.model, provider: 'meta' }
          )

          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            break
          }

          const toolsStartTime = Date.now()

          const toolExecutionPromises = toolCallsInResponse.map(async (toolCall) => {
            const toolCallStartTime = Date.now()
            const toolName = toolCall.function.name

            try {
              const toolArgs = parseToolArguments(toolCall.function.arguments, toolName)
              const tool = request.tools?.find((t) => t.id === toolName)

              // Every tool_call in the assistant message must be answered by a matching
              // `tool` message, or the next request violates the OpenAI message contract.
              // Emit an error result for an unknown tool rather than dropping it.
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

          for (const executionResult of executionResults) {
            const { toolCall, toolName, toolParams, result, startTime, endTime, duration } =
              executionResult

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
          currentResponse = await meta.chat.completions.create(
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
          }

          if (currentResponse.usage) {
            tokens.input += currentResponse.usage.prompt_tokens || 0
            tokens.output += currentResponse.usage.completion_tokens || 0
            tokens.total += currentResponse.usage.total_tokens || 0
          }

          iterationCount++
        }

        if (iterationCount === MAX_TOOL_ITERATIONS) {
          const cappedToolCalls = currentResponse.choices[0]?.message?.tool_calls
          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            currentResponse,
            cappedToolCalls,
            { model: request.model, provider: 'meta' }
          )

          if (cappedToolCalls?.length) {
            const { tools: _omittedTools, ...finalPayload } = payload
            finalPayload.messages = currentMessages
            if (deferResponseFormat && responseFormatPayload) {
              finalPayload.response_format = responseFormatPayload
              appliedDeferredResponseFormat = true
            }

            const finalModelStartTime = Date.now()
            currentResponse = await meta.chat.completions.create(
              finalPayload,
              request.abortSignal ? { signal: request.abortSignal } : undefined
            )
            const finalModelEndTime = Date.now()
            const finalModelDuration = finalModelEndTime - finalModelStartTime

            timeSegments.push({
              type: 'model',
              name: request.model,
              startTime: finalModelStartTime,
              endTime: finalModelEndTime,
              duration: finalModelDuration,
            })
            modelTime += finalModelDuration

            if (currentResponse.choices[0]?.message?.content) {
              content = currentResponse.choices[0].message.content
            }
            if (currentResponse.usage) {
              tokens.input += currentResponse.usage.prompt_tokens || 0
              tokens.output += currentResponse.usage.completion_tokens || 0
              tokens.total += currentResponse.usage.total_tokens || 0
            }

            enrichLastModelSegmentFromChatCompletions(
              timeSegments,
              currentResponse,
              currentResponse.choices[0]?.message?.tool_calls,
              { model: request.model, provider: 'meta' }
            )
            iterationCount++
          }
        }
      } catch (error) {
        logger.error('Error in Meta request:', { error })
        throw error
      }

      // Tools were active, so `response_format` was withheld from the loop. Make one final
      // tool-free call to obtain the structured response now that the tool work is done.
      // Meta rejects tool_choice: "none", so `tools` is dropped from this payload instead.
      if (deferResponseFormat && responseFormatPayload && !appliedDeferredResponseFormat) {
        logger.info('Applying deferred JSON schema response format after tool processing')

        const finalFormatStartTime = Date.now()
        const { tools: _omittedDeferredTools, ...deferredBasePayload } = payload
        const finalPayload: any = {
          ...deferredBasePayload,
          messages: currentMessages,
          response_format: responseFormatPayload,
        }

        currentResponse = await meta.chat.completions.create(
          finalPayload,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const finalFormatEndTime = Date.now()
        timeSegments.push({
          type: 'model',
          name: request.model,
          startTime: finalFormatStartTime,
          endTime: finalFormatEndTime,
          duration: finalFormatEndTime - finalFormatStartTime,
        })
        modelTime += finalFormatEndTime - finalFormatStartTime

        const formattedContent = currentResponse.choices[0]?.message?.content
        if (formattedContent) {
          content = formattedContent
        }

        if (currentResponse.usage) {
          tokens.input += currentResponse.usage.prompt_tokens || 0
          tokens.output += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        enrichLastModelSegmentFromChatCompletions(
          timeSegments,
          currentResponse,
          currentResponse.choices[0]?.message?.tool_calls,
          { model: request.model, provider: 'meta' }
        )
      }

      if (request.stream) {
        const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)
        const toolCost = sumToolCosts(toolResults)

        const streamingResult = createStreamingExecution({
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
          initialTokens: {
            input: tokens.input,
            output: tokens.output,
            total: tokens.total,
          },
          initialCost: {
            input: accumulatedCost.input,
            output: accumulatedCost.output,
            toolCost: toolCost || undefined,
            total: accumulatedCost.total + toolCost,
          },
          toolCalls:
            toolCalls.length > 0
              ? {
                  list: toolCalls,
                  count: toolCalls.length,
                }
              : undefined,
          isStreaming: true,
          streamFormat: 'agent-events-v1',
          createStream: ({ output, finalizeTiming }) => {
            output.content = content
            finalizeTiming()
            return createSettledAgentEventStream(content)
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
          iterations: timeSegments.filter((segment) => segment.type === 'model').length,
          timeSegments: timeSegments,
        },
      }
    } catch (error) {
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Meta request:', {
        error,
        duration: totalDuration,
      })

      if (isAbortError(error) || request.abortSignal?.aborted) {
        throw error
      }

      throw new ProviderError(toError(error).message, {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      })
    }
  },
}
