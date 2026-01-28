import { Cerebras } from '@cerebras/cerebras_cloud_sdk'
import { createLogger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import type { CerebrasResponse } from '@/providers/cerebras/types'
import { createReadableStreamFromCerebrasStream } from '@/providers/cerebras/utils'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import {
  calculateCost,
  prepareToolExecution,
  prepareToolsWithUsageControl,
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
        model: request.model.replace('cerebras/', ''),
        messages: allMessages,
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

        const streamResponse: any = await client.chat.completions.create({
          ...payload,
          stream: true,
        })

        const streamingResult = {
          stream: createReadableStreamFromCerebrasStream(streamResponse, (content, usage) => {
            streamingResult.execution.output.content = content
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
                    name: 'Streaming response',
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
            isStreaming: true,
          },
        }

        return streamingResult as StreamingExecution
      }
      const initialCallTime = Date.now()

      let currentResponse = (await client.chat.completions.create(payload)) as CerebrasResponse
      const firstResponseTime = Date.now() - initialCallTime

      let content = currentResponse.choices[0]?.message?.content || ''
      const tokens = {
        input: currentResponse.usage?.prompt_tokens || 0,
        output: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      const toolCalls = []
      const toolResults = []
      const currentMessages = [...allMessages]
      let iterationCount = 0

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

      const processedToolCallIds = new Set()
      const toolCallSignatures = new Set()
      try {
        while (iterationCount < MAX_TOOL_ITERATIONS) {
          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

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
              const toolArgs = JSON.parse(toolCall.function.arguments)
              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) return null

              const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
              const result = await executeTool(toolName, executionParams)
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
              logger.error('Error processing tool call (Cerebras):', {
                error: error instanceof Error ? error.message : String(error),
                toolName,
              })

              return {
                toolCall,
                toolName,
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
          currentMessages.push({
            role: 'assistant',
            content: null,
            tool_calls: filteredToolCalls.map((tc) => ({
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
            })
            let resultContent: any
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

            const finalResponse = (await client.chat.completions.create(
              finalPayload
            )) as CerebrasResponse

            const nextModelEndTime = Date.now()
            const thisModelTime = nextModelEndTime - nextModelStartTime

            timeSegments.push({
              type: 'model',
              name: 'Final response',
              startTime: nextModelStartTime,
              endTime: nextModelEndTime,
              duration: thisModelTime,
            })

            modelTime += thisModelTime

            if (finalResponse.choices[0]?.message?.content) {
              content = finalResponse.choices[0].message.content
            }
            if (finalResponse.usage) {
              tokens.input += finalResponse.usage.prompt_tokens || 0
              tokens.output += finalResponse.usage.completion_tokens || 0
              tokens.total += finalResponse.usage.total_tokens || 0
            }

            break
          }

          if (!processedAnyToolCall && !hasRepeatedToolCalls) {
            const nextPayload = {
              ...payload,
              messages: currentMessages,
            }

            const nextModelStartTime = Date.now()
            currentResponse = (await client.chat.completions.create(
              nextPayload
            )) as CerebrasResponse

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
              tokens.input += currentResponse.usage.prompt_tokens || 0
              tokens.output += currentResponse.usage.completion_tokens || 0
              tokens.total += currentResponse.usage.total_tokens || 0
            }

            iterationCount++
          }
        }
      } catch (error) {
        logger.error('Error in Cerebras tool processing:', { error })
      }

      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      if (request.stream) {
        logger.info('Using streaming for final Cerebras response after tool processing')

        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          tool_choice: 'auto',
          stream: true,
        }

        const streamResponse: any = await client.chat.completions.create(streamingPayload)

        const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

        const streamingResult = {
          stream: createReadableStreamFromCerebrasStream(streamResponse, (content, usage) => {
            streamingResult.execution.output.content = content
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
            streamingResult.execution.output.cost = {
              input: accumulatedCost.input + streamCost.input,
              output: accumulatedCost.output + streamCost.output,
              total: accumulatedCost.total + streamCost.total,
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
            isStreaming: true,
          },
        }

        return streamingResult as StreamingExecution
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

      const enhancedError = new Error(error instanceof Error ? error.message : String(error))
      // @ts-ignore - Adding timing property to error for debugging
      enhancedError.timing = {
        startTime: providerStartTimeISO,
        endTime: providerEndTimeISO,
        duration: totalDuration,
      }

      throw enhancedError
    }
  },
}
