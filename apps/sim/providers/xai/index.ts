import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { formatMessagesForProvider } from '@/providers/attachments'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { createOpenAICompatAssistantHistory } from '@/providers/openai-compat/assistant-history'
import { createSettledAgentEventStream } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { isAbortError, parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type {
  Message,
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
import {
  checkForForcedToolUsage,
  createReadableStreamFromXAIStream,
  createResponseFormatPayload,
} from '@/providers/xai/utils'
import { executeTool } from '@/tools'

const logger = createLogger('XAIProvider')

export const xAIProvider: ProviderConfig = {
  id: 'xai',
  name: 'xAI',
  description: "xAI's Grok models",
  version: '1.0.0',
  models: getProviderModels('xai'),
  defaultModel: getProviderDefaultModel('xai'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for xAI')
    }

    const xai = new OpenAI({
      apiKey: request.apiKey,
      baseURL: 'https://api.x.ai/v1',
    })

    logger.info('XAI Provider - Initial request configuration:', {
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
      model: request.model,
      streaming: !!request.stream,
    })

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
    const formattedMessages = formatMessagesForProvider(allMessages, 'xai') as Message[]
    const tools = request.tools?.length
      ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
      : undefined
    if (tools?.length && request.responseFormat) {
      logger.warn(
        'XAI Provider - Detected both tools and response format. Using tools first, then response format for final response.'
      )
    }
    const basePayload: any = {
      model: request.model,
      messages: formattedMessages,
    }

    if (request.temperature !== undefined) basePayload.temperature = request.temperature
    if (request.maxTokens != null) basePayload.max_completion_tokens = request.maxTokens
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (tools?.length) {
      preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, 'xai')
    }

    if (request.stream && (!tools || tools.length === 0)) {
      logger.info('XAI Provider - Using direct streaming (no tools)')

      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      const streamingParams: ChatCompletionCreateParamsStreaming = request.responseFormat
        ? {
            ...createResponseFormatPayload(basePayload, allMessages, request.responseFormat),
            stream: true,
            stream_options: { include_usage: true },
          }
        : { ...basePayload, stream: true, stream_options: { include_usage: true } }

      const streamResponse = await xai.chat.completions.create(
        streamingParams,
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
          createReadableStreamFromXAIStream(streamResponse, (content, usage) => {
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
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const initialCallTime = Date.now()

      // xAI cannot use tools and response_format together in the same request
      const initialPayload = { ...basePayload }

      let originalToolChoice: any
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      if (preparedTools?.tools?.length && preparedTools.toolChoice) {
        const { tools: filteredTools, toolChoice } = preparedTools
        initialPayload.tools = filteredTools
        initialPayload.tool_choice = toolChoice
        originalToolChoice = toolChoice
      } else if (request.responseFormat) {
        const responseFormatPayload = createResponseFormatPayload(
          basePayload,
          allMessages,
          request.responseFormat
        )
        Object.assign(initialPayload, responseFormatPayload)
      }

      let currentResponse = await xai.chat.completions.create(
        initialPayload,
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
      if (originalToolChoice) {
        const result = checkForForcedToolUsage(
          currentResponse,
          originalToolChoice,
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
            { model: request.model, provider: 'xai' }
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

              if (!tool) {
                logger.warn('XAI Provider - Tool not found:', { toolName })
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
              logger.error('XAI Provider - Error processing tool call:', {
                error: toError(error).message,
                toolCall: toolCall.function.name,
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
                toolCalls: toolCallsInResponse,
                reasoningFields: ['reasoning_content'],
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
              logger.warn('XAI Provider - Tool execution failed:', {
                toolName,
                error: result.error,
              })
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

          let nextPayload: any
          if (
            typeof originalToolChoice === 'object' &&
            hasUsedForcedTool &&
            forcedTools.length > 0
          ) {
            const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

            if (remainingTools.length > 0) {
              nextPayload = {
                ...basePayload,
                messages: currentMessages,
                tools: preparedTools?.tools,
                tool_choice: {
                  type: 'function',
                  function: { name: remainingTools[0] },
                },
              }
            } else {
              if (request.responseFormat) {
                nextPayload = createResponseFormatPayload(
                  basePayload,
                  allMessages,
                  request.responseFormat,
                  currentMessages
                )
              } else {
                nextPayload = {
                  ...basePayload,
                  messages: currentMessages,
                  tool_choice: 'auto',
                  tools: preparedTools?.tools,
                }
              }
            }
          } else {
            if (request.responseFormat) {
              nextPayload = createResponseFormatPayload(
                basePayload,
                allMessages,
                request.responseFormat,
                currentMessages
              )
            } else {
              nextPayload = {
                ...basePayload,
                messages: currentMessages,
                tools: preparedTools?.tools,
                tool_choice: 'auto',
              }
            }
          }

          const nextModelStartTime = Date.now()

          currentResponse = await xai.chat.completions.create(
            nextPayload,
            request.abortSignal ? { signal: request.abortSignal } : undefined
          )
          if (nextPayload.tool_choice && typeof nextPayload.tool_choice === 'object') {
            const result = checkForForcedToolUsage(
              currentResponse,
              nextPayload.tool_choice,
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
          const pendingToolCalls = currentResponse.choices[0]?.message?.tool_calls
          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            currentResponse,
            pendingToolCalls,
            { model: request.model, provider: 'xai' }
          )

          if (pendingToolCalls?.length) {
            const finalPayload = request.responseFormat
              ? createResponseFormatPayload(
                  basePayload,
                  allMessages,
                  request.responseFormat,
                  currentMessages
                )
              : {
                  ...basePayload,
                  messages: currentMessages,
                  tools: preparedTools?.tools,
                  tool_choice: 'none',
                }
            const finalStartTime = Date.now()
            const finalResponse = await xai.chat.completions.create(
              finalPayload,
              request.abortSignal ? { signal: request.abortSignal } : undefined
            )
            const finalEndTime = Date.now()
            const finalDuration = finalEndTime - finalStartTime

            timeSegments.push({
              type: 'model',
              name: 'Final answer after tool iteration limit',
              startTime: finalStartTime,
              endTime: finalEndTime,
              duration: finalDuration,
            })
            modelTime += finalDuration

            if (finalResponse.choices[0]?.message?.content) {
              content = finalResponse.choices[0].message.content
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
              { model: request.model, provider: 'xai' }
            )
          }
        }
      } catch (error) {
        logger.error('XAI Provider - Error in tool processing loop:', {
          error: toError(error).message,
          iterationCount,
        })
        throw error
      }
      if (request.stream) {
        const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)
        const toolCost = sumToolCosts(toolResults)
        const finalCost = {
          input: accumulatedCost.input,
          output: accumulatedCost.output,
          toolCost: toolCost || undefined,
          total: accumulatedCost.total + toolCost,
        }

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
          initialCost: finalCost,
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
            output.tokens = { input: tokens.input, output: tokens.output, total: tokens.total }
            output.cost = finalCost
            finalizeTiming()
            return createSettledAgentEventStream(content)
          },
        })

        return streamingResult
      }
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.info('XAI Provider - Request completed:', {
        totalDuration,
        iterationCount: iterationCount + 1,
        toolCallCount: toolCalls.length,
        hasContent: !!content,
        contentLength: content?.length || 0,
      })

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

      logger.error('XAI Provider - Request failed:', {
        error: toError(error).message,
        duration: totalDuration,
        hasTools: !!tools?.length,
        hasResponseFormat: !!request.responseFormat,
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
