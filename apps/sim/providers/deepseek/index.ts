import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import OpenAI from 'openai'
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import { createReadableStreamFromDeepseekStream } from '@/providers/deepseek/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { createOpenAICompatStreamingToolLoopStream } from '@/providers/openai-compat/streaming-tool-loop'
import { createStreamingExecution } from '@/providers/streaming-execution'
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

const logger = createLogger('DeepseekProvider')

export const deepseekProvider: ProviderConfig = {
  id: 'deepseek',
  name: 'Deepseek',
  description: "Deepseek's chat models",
  version: '1.0.0',
  models: getProviderModels('deepseek'),
  defaultModel: getProviderDefaultModel('deepseek'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Deepseek')
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const deepseek = new OpenAI({
        apiKey: request.apiKey,
        baseURL: 'https://api.deepseek.com/v1',
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
      const formattedMessages = formatMessagesForProvider(allMessages, 'deepseek')

      const tools = request.tools?.length
        ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
        : undefined

      const payload: any = {
        model: request.model,
        messages: formattedMessages,
      }

      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens != null) payload.max_tokens = request.maxTokens

      /**
       * DeepSeek Think mode: reasoning_content streams when enabled (or inherent
       * on reasoner). The API default is enabled, so 'none' must explicitly send
       * `disabled`; unset sends nothing to preserve the legacy request shape.
       */
      if (request.thinkingLevel && request.thinkingLevel !== 'none') {
        payload.thinking = { type: 'enabled' }
      } else if (request.thinkingLevel === 'none') {
        payload.thinking = { type: 'disabled' }
      }

      let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

      if (tools?.length) {
        preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'deepseek')
        const { tools: filteredTools, toolChoice } = preparedTools

        if (filteredTools?.length && toolChoice) {
          payload.tools = filteredTools
          payload.tool_choice = toolChoice

          logger.info('Deepseek request configuration:', {
            toolCount: filteredTools.length,
            toolChoice:
              typeof toolChoice === 'string'
                ? toolChoice
                : toolChoice.type === 'function'
                  ? `force:${toolChoice.function.name}`
                  : toolChoice.type === 'tool'
                    ? `force:${toolChoice.name}`
                    : toolChoice.type === 'any'
                      ? `force:${toolChoice.any?.name || 'unknown'}`
                      : 'unknown',
            model: request.model,
          })
        }
      }

      const shouldStreamToolCalls = request.streamToolCalls ?? false

      if (request.stream && shouldStreamToolCalls && payload.tools?.length) {
        logger.info('Using streaming tool loop for DeepSeek request')

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
            createOpenAICompatStreamingToolLoopStream({
              providerName: 'Deepseek',
              request,
              basePayload: payload,
              messages:
                // double-cast-allowed: formatMessagesForProvider returns loosely-typed provider messages that are wire-compatible with the OpenAI chat.completions message params the shared loop expects
                formattedMessages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
              createStream: async (params, options) =>
                deepseek.chat.completions.create({ ...params, stream: true }, options),
              logger,
              timeSegments,
              forcedTools,
              /**
               * DeepSeek requires reasoning_content passed back on tool-call
               * turns whenever the API returns it (thinking defaults to enabled
               * server-side); it is ignored on non-tool turns, so preserving
               * unconditionally is always safe.
               */
              preserveAssistantReasoning: true,
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

      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for DeepSeek request (no tools)')

        const streamResponse = await deepseek.chat.completions.create(
          {
            ...payload,
            stream: true,
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
            createReadableStreamFromDeepseekStream(
              // double-cast-allowed: payload is untyped so the SDK cannot resolve the streaming overload; the stream yields OpenAI ChatCompletionChunk objects
              streamResponse as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
              (content, usage, thinking) => {
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

                if (thinking) {
                  const segment = output.providerTiming?.timeSegments?.[0]
                  if (segment) {
                    segment.thinkingContent = thinking
                  }
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

      let currentResponse = await deepseek.chat.completions.create(
        payload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''

      if (content) {
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
          'deepseek',
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
            { model: request.model, provider: 'deepseek' }
          )

          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            break
          }

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

          const assistantMessage = currentResponse.choices[0]?.message
          const assistantHistory: {
            role: string
            content: string | null
            tool_calls: Array<{
              id: string
              type: string
              function: { name: string; arguments: string }
            }>
            reasoning_content?: string
          } = {
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
          }
          /**
           * DeepSeek requires reasoning_content passed back on tool-call turns
           * whenever the API returns it (thinking defaults to enabled
           * server-side, so this applies even without an explicit thinking
           * level); it is ignored on non-tool turns.
           */
          if (assistantMessage) {
            const reasoningContent = (assistantMessage as { reasoning_content?: string })
              .reasoning_content
            if (typeof reasoningContent === 'string' && reasoningContent.length > 0) {
              assistantHistory.reasoning_content = reasoningContent
            }
          }
          currentMessages.push(assistantHistory)

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
          currentResponse = await deepseek.chat.completions.create(
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
              'deepseek',
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
            content = content.replace(/```json\n?|\n?```/g, '')
            content = content.trim()
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
            { model: request.model, provider: 'deepseek' }
          )
        }
      } catch (error) {
        logger.error('Error in Deepseek request:', { error })
      }

      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      if (request.stream) {
        logger.info('Using streaming for final DeepSeek response after tool processing')

        /**
         * The regeneration exists purely to stream the settled answer as prose —
         * streamed tool_calls are never executed on this path; with `auto` a
         * model can re-call and end the stream with no text.
         */
        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'none',
          stream: true,
        }

        const streamResponse = await deepseek.chat.completions.create(
          streamingPayload,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

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
          initialTokens: {
            input: tokens.input,
            output: tokens.output,
            total: tokens.total,
          },
          initialCost: {
            input: accumulatedCost.input,
            output: accumulatedCost.output,
            toolCost: undefined as number | undefined,
            total: accumulatedCost.total,
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
          createStream: ({ output }) =>
            createReadableStreamFromDeepseekStream(
              // double-cast-allowed: payload is untyped so the SDK cannot resolve the streaming overload; the stream yields OpenAI ChatCompletionChunk objects
              streamResponse as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
              (streamedContent, usage, thinking) => {
                if (!streamedContent && content) {
                  logger.warn('DeepSeek final stream produced no text; keeping tool-loop answer')
                }
                output.content = streamedContent || content
                output.tokens = {
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
                output.cost = {
                  input: accumulatedCost.input + streamCost.input,
                  output: accumulatedCost.output + streamCost.output,
                  toolCost: tc || undefined,
                  total: accumulatedCost.total + streamCost.total + tc,
                }

                if (thinking) {
                  const lastModel = [...timeSegments].reverse().find((s) => s.type === 'model')
                  if (lastModel) {
                    lastModel.thinkingContent = thinking
                  }
                }
              }
            ),
        })

        return streamingResult
      }

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

      logger.error('Error in Deepseek request:', {
        error,
        duration: totalDuration,
      })

      throw new ProviderError(toError(error).message, {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      })
    }
  },
}
