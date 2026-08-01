import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import type { CerebrasResponse } from '@/providers/cerebras/types'
import { createReadableStreamFromCerebrasStream } from '@/providers/cerebras/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { createOpenAICompatAssistantHistory } from '@/providers/openai-compat/assistant-history'
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

const logger = createLogger('CerebrasProvider')

export const cerebrasProvider: ProviderConfig = {
  id: 'cerebras',
  name: 'Cerebras',
  description: 'Cerebras Cloud LLMs',
  version: '1.0.0',
  models: getProviderModels('cerebras'),
  defaultModel: getProviderDefaultModel('cerebras'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Cerebras')
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const client = new Cerebras({
        apiKey: request.apiKey,
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
      const formattedMessages = formatMessagesForProvider(allMessages, 'cerebras')

      const tools = request.tools?.length
        ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
        : undefined

      const payload: any = {
        model: request.model.replace('cerebras/', ''),
        messages: formattedMessages,
      }
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens != null) payload.max_completion_tokens = request.maxTokens
      if (request.responseFormat) {
        payload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.responseFormat.name || 'response_schema',
            schema: request.responseFormat.schema || request.responseFormat,
            strict: request.responseFormat.strict !== false,
          },
        }
      }

      let originalToolChoice: any
      let forcedTools: string[] = []
      let hasFilteredTools = false

      if (tools?.length) {
        const preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'openai')

        if (preparedTools.tools?.length) {
          payload.tools = preparedTools.tools
          payload.tool_choice = preparedTools.toolChoice || 'auto'
          originalToolChoice = preparedTools.toolChoice
          forcedTools = preparedTools.forcedTools || []
          hasFilteredTools = preparedTools.hasFilteredTools

          logger.info('Cerebras request configuration:', {
            toolCount: preparedTools.tools.length,
            toolChoice: payload.tool_choice,
            forcedToolsCount: forcedTools.length,
            hasFilteredTools,
            model: request.model,
          })
        }
      }

      if (request.stream && (!tools || tools.length === 0)) {
        logger.info('Using streaming response for Cerebras request (no tools)')

        const streamResponse: any = await client.chat.completions.create(
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
            createReadableStreamFromCerebrasStream(streamResponse, (content, usage) => {
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
            }),
        })

        return streamingResult
      }
      const initialCallTime = Date.now()

      let currentResponse = (await client.chat.completions.create(
        payload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )) as CerebrasResponse
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

      const processedToolCallIds = new Set()
      const toolCallSignatures = new Set()
      try {
        while (iterationCount < MAX_TOOL_ITERATIONS) {
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            currentResponse,
            toolCallsInResponse,
            { model: request.model, provider: 'cerebras' }
          )

          if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
            if (currentResponse.choices[0]?.message?.content) {
              content = currentResponse.choices[0].message.content
            }
            break
          }

          const toolsStartTime = Date.now()
          let hasRepeatedToolCalls = false
          const filteredToolCalls = toolCallsInResponse.filter((toolCall) => {
            if (processedToolCallIds.has(toolCall.id)) {
              return false
            }
            const toolCallSignature = `${toolCall.function.name}-${toolCall.function.arguments}`
            if (toolCallSignatures.has(toolCallSignature)) {
              hasRepeatedToolCalls = true
              return false
            }
            processedToolCallIds.add(toolCall.id)
            toolCallSignatures.add(toolCallSignature)
            return true
          })

          const processedAnyToolCall = filteredToolCalls.length > 0
          const toolExecutionPromises = filteredToolCalls.map(async (toolCall) => {
            const toolCallStartTime = Date.now()
            const toolName = toolCall.function.name

            try {
              const toolArgs = parseToolArguments(toolCall.function.arguments, toolName)
              const tool = request.tools?.find((t) => t.id === toolName)
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
              logger.error('Error processing tool call (Cerebras):', {
                error: toError(error).message,
                toolName,
              })

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
                toolCalls: filteredToolCalls,
                reasoningFields: ['reasoning'],
              })
            )
          }

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
          let usedForcedTools: string[] = []
          if (typeof originalToolChoice === 'object' && forcedTools.length > 0) {
            const toolTracking = trackForcedToolUsage(
              currentResponse.choices[0]?.message?.tool_calls,
              originalToolChoice,
              logger,
              'openai',
              forcedTools,
              usedForcedTools
            )
            usedForcedTools = toolTracking.usedForcedTools
            const nextToolChoice = toolTracking.nextToolChoice
            if (nextToolChoice && typeof nextToolChoice === 'object') {
              payload.tool_choice = nextToolChoice
            } else if (nextToolChoice === 'auto' || !nextToolChoice) {
              payload.tool_choice = 'auto'
            }
          }

          if (processedAnyToolCall || hasRepeatedToolCalls) {
            const nextModelStartTime = Date.now()

            const finalPayload = {
              ...payload,
              messages: currentMessages,
            }
            finalPayload.tool_choice = 'none'

            currentResponse = (await client.chat.completions.create(
              finalPayload,
              request.abortSignal ? { signal: request.abortSignal } : undefined
            )) as CerebrasResponse

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

            enrichLastModelSegmentFromChatCompletions(
              timeSegments,
              currentResponse,
              currentResponse.choices[0]?.message?.tool_calls,
              { model: request.model, provider: 'cerebras' }
            )

            iterationCount++
            break
          }

          if (!processedAnyToolCall && !hasRepeatedToolCalls) {
            const nextPayload = {
              ...payload,
              messages: currentMessages,
            }

            const nextModelStartTime = Date.now()
            currentResponse = (await client.chat.completions.create(
              nextPayload,
              request.abortSignal ? { signal: request.abortSignal } : undefined
            )) as CerebrasResponse

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
              tokens.input += currentResponse.usage.prompt_tokens || 0
              tokens.output += currentResponse.usage.completion_tokens || 0
              tokens.total += currentResponse.usage.total_tokens || 0
            }

            iterationCount++
          }
        }

        const cappedToolCalls = currentResponse.choices[0]?.message?.tool_calls
        if (iterationCount === MAX_TOOL_ITERATIONS && cappedToolCalls?.length) {
          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            currentResponse,
            cappedToolCalls,
            { model: request.model, provider: 'cerebras' }
          )

          const finalModelStartTime = Date.now()
          currentResponse = (await client.chat.completions.create(
            {
              ...payload,
              messages: currentMessages,
              tool_choice: 'none',
            },
            request.abortSignal ? { signal: request.abortSignal } : undefined
          )) as CerebrasResponse
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
            { model: request.model, provider: 'cerebras' }
          )
          iterationCount++
        }
      } catch (error) {
        logger.error('Error in Cerebras tool processing:', { error })
        throw error
      }

      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

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

      logger.error('Error in Cerebras request:', {
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

/**
 * Enriches the last model segment with per-iteration content from a Chat
 * Completions response: assistant text, tool calls, finish reason, token usage.
 */
