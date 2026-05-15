import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import type {
  FunctionCallResponse,
  Message,
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  TimeSegment,
} from '@/providers/types'
import { ProviderError } from '@/providers/types'
import {
  calculateCost,
  generateSchemaInstructions,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  sumToolCosts,
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('AstraflowProvider')

function createAstraflowClient(apiKey: string, providerId: 'astraflow' | 'astraflow-cn') {
  const baseURL =
    providerId === 'astraflow-cn'
      ? 'https://api.modelverse.cn/v1'
      : 'https://api-us-ca.umodelverse.ai/v1'
  return new OpenAI({ apiKey, baseURL })
}

function applyResponseFormat(targetPayload: any, messages: any[], responseFormat: any): any[] {
  const schema = responseFormat.schema || responseFormat
  const schemaInstructions = generateSchemaInstructions(schema, responseFormat.name)
  targetPayload.response_format = { type: 'json_object' }
  return [...messages, { role: 'user', content: schemaInstructions }]
}

function makeProvider(providerId: 'astraflow' | 'astraflow-cn'): ProviderConfig {
  const displayName = providerId === 'astraflow-cn' ? 'Astraflow (CN)' : 'Astraflow'
  const description =
    providerId === 'astraflow-cn'
      ? 'Astraflow by UCloud — OpenAI-compatible platform supporting 200+ models (China endpoint)'
      : 'Astraflow by UCloud — OpenAI-compatible platform supporting 200+ models (global endpoint)'

  return {
    id: providerId,
    name: displayName,
    description,
    version: '1.0.0',
    models: getProviderModels(providerId),
    defaultModel: getProviderDefaultModel(providerId),

    executeRequest: async (
      request: ProviderRequest
    ): Promise<ProviderResponse | StreamingExecution> => {
      if (!request.apiKey) {
        throw new Error(`API key is required for ${displayName}`)
      }

      const client = createAstraflowClient(request.apiKey, providerId)

      logger.info(`${displayName} Provider - Initial request configuration:`, {
        hasTools: !!request.tools?.length,
        toolCount: request.tools?.length || 0,
        hasResponseFormat: !!request.responseFormat,
        model: request.model,
        streaming: !!request.stream,
      })

      const allMessages: Message[] = []

      if (request.systemPrompt) {
        allMessages.push({ role: 'system', content: request.systemPrompt })
      }
      if (request.context) {
        allMessages.push({ role: 'user', content: request.context })
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

      const basePayload: any = { model: request.model, messages: allMessages }
      if (request.temperature !== undefined) basePayload.temperature = request.temperature
      if (request.maxTokens != null) basePayload.max_tokens = request.maxTokens

      let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null
      if (tools?.length) {
        preparedTools = prepareToolsWithUsageControl(tools, request.tools, logger, providerId)
      }

      // ── Streaming (no tools) ──────────────────────────────────────────────
      if (request.stream && (!tools || tools.length === 0)) {
        const providerStartTime = Date.now()
        const providerStartTimeISO = new Date(providerStartTime).toISOString()

        const streamPayload: any = { ...basePayload }
        if (request.responseFormat) {
          streamPayload.messages = applyResponseFormat(
            streamPayload,
            allMessages,
            request.responseFormat
          )
        }
        const streamingParams: ChatCompletionCreateParamsStreaming = {
          ...streamPayload,
          stream: true,
          stream_options: { include_usage: true },
        }

        const streamResponse = await client.chat.completions.create(
          streamingParams,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )

        const streamingResult = {
          stream: new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder()
              let fullContent = ''
              let finalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
              try {
                for await (const chunk of streamResponse as any) {
                  const delta = chunk.choices?.[0]?.delta?.content
                  if (delta) {
                    fullContent += delta
                    controller.enqueue(encoder.encode(delta))
                  }
                  if (chunk.usage) finalUsage = chunk.usage
                }
              } finally {
                const costResult = calculateCost(
                  request.model,
                  finalUsage.prompt_tokens,
                  finalUsage.completion_tokens
                )
                streamingResult.execution.output.content = fullContent
                streamingResult.execution.output.tokens = {
                  input: finalUsage.prompt_tokens,
                  output: finalUsage.completion_tokens,
                  total: finalUsage.total_tokens,
                }
                streamingResult.execution.output.cost = {
                  input: costResult.input,
                  output: costResult.output,
                  total: costResult.total,
                }
                controller.close()
              }
            },
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
                    type: 'model' as const,
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

        return streamingResult
      }

      // ── Non-streaming / tool loop ─────────────────────────────────────────
      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      try {
        const initialCallTime = Date.now()
        const initialPayload = { ...basePayload }
        let originalToolChoice: any
        const forcedTools = preparedTools?.forcedTools || []
        let usedForcedTools: string[] = []

        if (preparedTools?.tools?.length && preparedTools.toolChoice) {
          initialPayload.tools = preparedTools.tools
          initialPayload.tool_choice = preparedTools.toolChoice
          originalToolChoice = preparedTools.toolChoice
        } else if (request.responseFormat && !tools?.length) {
          initialPayload.messages = applyResponseFormat(
            initialPayload,
            allMessages,
            request.responseFormat
          )
        }

        let currentResponse = await client.chat.completions.create(
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
        const toolCalls: FunctionCallResponse[] = []
        const toolResults: Record<string, unknown>[] = []
        const currentMessages = [...allMessages]
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
          }

          const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls

          enrichLastModelSegmentFromChatCompletions(
            timeSegments,
            currentResponse,
            toolCallsInResponse,
            { model: request.model, provider: providerId }
          )

          if (!toolCallsInResponse || toolCallsInResponse.length === 0) break

          const toolsStartTime = Date.now()
          const toolExecutionPromises = toolCallsInResponse.map(async (toolCall) => {
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
              logger.error(`${displayName} Provider - Error processing tool call:`, {
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
            tool_calls: toolCallsInResponse.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          })

          for (const settledResult of executionResults) {
            if (settledResult.status === 'rejected' || !settledResult.value) continue
            const { toolCall, toolName, toolParams, result, startTime, endTime, duration } =
              settledResult.value
            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime,
              endTime,
              duration,
              toolCallId: toolCall.id,
            })
            let resultContent: any
            if (result.success) {
              toolResults.push(result.output!)
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
              duration,
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

          let nextPayload: any = { ...basePayload, messages: currentMessages }
          if (
            typeof originalToolChoice === 'object' &&
            forcedTools.length > 0
          ) {
            const remaining = forcedTools.filter((t) => !usedForcedTools.includes(t))
            nextPayload.tool_choice =
              remaining.length > 0
                ? { type: 'function', function: { name: remaining[0] } }
                : 'auto'
          } else {
            nextPayload.tools = preparedTools?.tools
            nextPayload.tool_choice = 'auto'
          }

          const nextModelStartTime = Date.now()
          currentResponse = await client.chat.completions.create(
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

        // Handle response format after tools if needed
        if (request.responseFormat && toolCalls.length > 0) {
          const finalPayload: any = {
            ...basePayload,
            messages: [...currentMessages],
          }
          finalPayload.messages = applyResponseFormat(
            finalPayload,
            finalPayload.messages,
            request.responseFormat
          )
          const finalStartTime = Date.now()
          const finalResponse = await client.chat.completions.create(
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
          content = finalResponse.choices[0]?.message?.content || content
          if (finalResponse.usage) {
            tokens.input += finalResponse.usage.prompt_tokens || 0
            tokens.output += finalResponse.usage.completion_tokens || 0
            tokens.total += finalResponse.usage.total_tokens || 0
          }
        }

        const providerEndTime = Date.now()
        const providerEndTimeISO = new Date(providerEndTime).toISOString()
        const totalDuration = providerEndTime - providerStartTime
        const costResult = calculateCost(request.model, tokens.input, tokens.output)
        const tc = sumToolCosts(toolResults)

        logger.info(`${displayName} Provider - Request completed:`, {
          totalDuration,
          iterationCount: iterationCount + 1,
          toolCallCount: toolCalls.length,
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
            modelTime,
            toolsTime,
            firstResponseTime,
            iterations: iterationCount + 1,
            timeSegments,
          },
          cost: {
            input: costResult.input,
            output: costResult.output,
            toolCost: tc || undefined,
            total: costResult.total + tc,
            pricing: costResult.pricing,
          },
        } as ProviderResponse
      } catch (error) {
        const providerEndTime = Date.now()
        const providerEndTimeISO = new Date(providerEndTime).toISOString()
        const totalDuration = providerEndTime - providerStartTime
        logger.error(`${displayName} Provider - Request failed:`, {
          error: toError(error).message,
        })
        throw new ProviderError(toError(error).message, {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
        })
      }
    },
  }
}

export const astraflowProvider = makeProvider('astraflow')
export const astraflowCNProvider = makeProvider('astraflow-cn')
