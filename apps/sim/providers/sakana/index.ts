import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import OpenAI from 'openai'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { createReadableStreamFromSakanaStream } from '@/providers/sakana/utils'
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
  trackForcedToolUsage,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('SakanaProvider')

const SAKANA_BASE_URL = 'https://api.sakana.ai/v1'

export const sakanaProvider: ProviderConfig = {
  id: 'sakana',
  name: 'Sakana AI',
  description: "Sakana AI's Fugu multi-agent models via an OpenAI-compatible API",
  version: '1.0.0',
  models: getProviderModels('sakana'),
  defaultModel: getProviderDefaultModel('sakana'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Sakana AI')
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const sakana = new OpenAI({
        apiKey: request.apiKey,
        baseURL: SAKANA_BASE_URL,
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
      const formattedMessages = formatMessagesForProvider(allMessages, 'sakana')

      const tools = request.tools?.length
        ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
        : undefined

      const payload: any = {
        model: request.model,
        messages: formattedMessages,
      }

      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens != null) payload.max_completion_tokens = request.maxTokens

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
          payload.tool_choice = toolChoice
          hasActiveTools = true

          logger.info('Sakana request configuration:', {
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
        logger.info('Using streaming response for Sakana request (no tools)')

        const streamResponse = await sakana.chat.completions.create(
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
            createReadableStreamFromSakanaStream(
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
      const originalToolChoice = payload.tool_choice
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      let currentResponse = await sakana.chat.completions.create(
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

      if (
        typeof originalToolChoice === 'object' &&
        currentResponse.choices[0]?.message?.tool_calls
      ) {
        const toolCallsResponse = currentResponse.choices[0].message.tool_calls
        const result = trackForcedToolUsage(
          toolCallsResponse,
          originalToolChoice,
          logger,
          'openai',
          forcedTools,
          usedForcedTools
        )
        hasUsedForcedTool = result.hasUsedForcedTool
        usedForcedTools = result.usedForcedTools
      }

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
            { model: request.model, provider: 'sakana' }
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

          if (
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
            const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

            if (remainingTools.length > 0) {
              nextPayload.tool_choice = {
                type: 'function',
                function: { name: remainingTools[0] },
              }
              logger.info(`Forcing next tool: ${remainingTools[0]}`)
            } else {
              nextPayload.tool_choice = 'auto'
              logger.info('All forced tools have been used, switching to auto tool_choice')
            }
          }

          const nextModelStartTime = Date.now()
          currentResponse = await sakana.chat.completions.create(
            nextPayload,
            request.abortSignal ? { signal: request.abortSignal } : undefined
          )

          if (
            typeof nextPayload.tool_choice === 'object' &&
            currentResponse.choices[0]?.message?.tool_calls
          ) {
            const toolCallsResponse = currentResponse.choices[0].message.tool_calls
            const result = trackForcedToolUsage(
              toolCallsResponse,
              nextPayload.tool_choice,
              logger,
              'openai',
              forcedTools,
              usedForcedTools
            )
            hasUsedForcedTool = result.hasUsedForcedTool
            usedForcedTools = result.usedForcedTools
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
            { model: request.model, provider: 'sakana' }
          )

          if (cappedToolCalls?.length) {
            const finalPayload: any = {
              ...payload,
              messages: currentMessages,
              tool_choice: 'none',
            }
            if (deferResponseFormat && responseFormatPayload) {
              finalPayload.response_format = responseFormatPayload
              finalPayload.parallel_tool_calls = false
              appliedDeferredResponseFormat = true
            }

            const finalModelStartTime = Date.now()
            currentResponse = await sakana.chat.completions.create(
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
              { model: request.model, provider: 'sakana' }
            )
            iterationCount++
          }
        }
      } catch (error) {
        logger.error('Error in Sakana request:', { error })
        throw error
      }

      // Tools were active, so `response_format` was withheld from the loop. Make one final
      // tool-free call to obtain the structured response now that the tool work is done.
      if (deferResponseFormat && responseFormatPayload && !appliedDeferredResponseFormat) {
        logger.info('Applying deferred JSON schema response format after tool processing')

        const finalFormatStartTime = Date.now()
        const finalPayload: any = {
          ...payload,
          messages: currentMessages,
          response_format: responseFormatPayload,
          tool_choice: 'none',
          parallel_tool_calls: false,
        }

        currentResponse = await sakana.chat.completions.create(
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
          { model: request.model, provider: 'sakana' }
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

      logger.error('Error in Sakana request:', {
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
