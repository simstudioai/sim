import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  checkForForcedToolUsage,
  createReadableStreamFromAnthropicStream,
  generateToolUseId,
} from '@/providers/anthropic/utils'
import {
  getProviderDefaultModel,
  getProviderModels,
  supportsNativeStructuredOutputs,
} from '@/providers/models'
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
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('AnthropicProvider')

/**
 * Generates prompt-based schema instructions for older models that don't support native structured outputs.
 * This is a fallback approach that adds schema requirements to the system prompt.
 */
function generateSchemaInstructions(schema: any, schemaName?: string): string {
  const name = schemaName || 'response'
  return `IMPORTANT: You must respond with a valid JSON object that conforms to the following schema.
Do not include any text before or after the JSON object. Only output the JSON.

Schema name: ${name}
JSON Schema:
${JSON.stringify(schema, null, 2)}

Your response must be valid JSON that exactly matches this schema structure.`
}

export const anthropicProvider: ProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic',
  description: "Anthropic's Claude models",
  version: '1.0.0',
  models: getProviderModels('anthropic'),
  defaultModel: getProviderDefaultModel('anthropic'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Anthropic')
    }

    const modelId = request.model
    const useNativeStructuredOutputs = !!(
      request.responseFormat && supportsNativeStructuredOutputs(modelId)
    )

    const anthropic = new Anthropic({
      apiKey: request.apiKey,
      defaultHeaders: useNativeStructuredOutputs
        ? { 'anthropic-beta': 'structured-outputs-2025-11-13' }
        : undefined,
    })

    const messages: any[] = []
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
                tool_use_id: msg.name,
                content: msg.content,
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

    let anthropicTools = request.tools?.length
      ? request.tools.map((tool) => ({
          name: tool.id,
          description: tool.description,
          input_schema: {
            type: 'object',
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
          'anthropic'
        )
        const { tools: filteredTools, toolChoice: tc } = preparedTools

        if (filteredTools?.length) {
          anthropicTools = filteredTools

          if (typeof tc === 'object' && tc !== null) {
            if (tc.type === 'tool') {
              toolChoice = tc
              logger.info(`Using Anthropic tool_choice format: force tool "${tc.name}"`)
            } else {
              toolChoice = 'auto'
              logger.warn('Received non-Anthropic tool_choice format, defaulting to auto')
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

    const payload: any = {
      model: request.model,
      messages,
      system: systemPrompt,
      max_tokens: Number.parseInt(String(request.maxTokens)) || 1024,
      temperature: Number.parseFloat(String(request.temperature ?? 0.7)),
    }

    if (request.responseFormat) {
      const schema = request.responseFormat.schema || request.responseFormat

      if (useNativeStructuredOutputs) {
        const schemaWithConstraints = {
          ...schema,
          additionalProperties: false,
        }
        payload.output_format = {
          type: 'json_schema',
          schema: schemaWithConstraints,
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

    if (anthropicTools?.length) {
      payload.tools = anthropicTools
      if (toolChoice !== 'auto') {
        payload.tool_choice = toolChoice
      }
    }

    const shouldStreamToolCalls = request.streamToolCalls ?? false

    if (request.stream && (!anthropicTools || anthropicTools.length === 0)) {
      logger.info('Using streaming response for Anthropic request (no tools)')

      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      const streamResponse: any = await anthropic.messages.create({
        ...payload,
        stream: true,
      })

      const streamingResult = {
        stream: createReadableStreamFromAnthropicStream(streamResponse, (content, usage) => {
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
      logger.info('Using non-streaming mode for Anthropic request (tool calls executed silently)')

      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      try {
        const initialCallTime = Date.now()
        const originalToolChoice = payload.tool_choice
        const forcedTools = preparedTools?.forcedTools || []
        let usedForcedTools: string[] = []

        let currentResponse = await anthropic.messages.create(payload)
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
            (currentResponse.usage?.input_tokens || 0) +
            (currentResponse.usage?.output_tokens || 0),
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
              const toolArgs = toolUse.input as Record<string, any>

              try {
                const tool = request.tools?.find((t: any) => t.id === toolName)
                if (!tool) return null

                const { toolParams, executionParams } = prepareToolExecution(
                  tool,
                  toolArgs,
                  request
                )
                const result = await executeTool(toolName, executionParams, true)
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

            for (const settledResult of executionResults) {
              if (settledResult.status === 'rejected' || !settledResult.value) continue

              const { toolName, toolArgs, toolParams, result, startTime, endTime, duration } =
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

              const toolUseId = generateToolUseId(toolName)

              currentMessages.push({
                role: 'assistant',
                content: [
                  {
                    type: 'tool_use',
                    id: toolUseId,
                    name: toolName,
                    input: toolArgs,
                  } as any,
                ],
              })

              currentMessages.push({
                role: 'user',
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: toolUseId,
                    content: JSON.stringify(resultContent),
                  } as any,
                ],
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
                  type: 'tool',
                  name: remainingTools[0],
                }
                logger.info(`Forcing next tool: ${remainingTools[0]}`)
              } else {
                nextPayload.tool_choice = undefined
                logger.info('All forced tools have been used, removing tool_choice parameter')
              }
            } else if (hasUsedForcedTool && typeof originalToolChoice === 'object') {
              nextPayload.tool_choice = undefined
              logger.info(
                'Removing tool_choice parameter for subsequent requests after forced tool was used'
              )
            }

            const nextModelStartTime = Date.now()

            currentResponse = await anthropic.messages.create(nextPayload)

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
                (currentResponse.usage.input_tokens || 0) +
                (currentResponse.usage.output_tokens || 0)
            }

            iterationCount++
          }
        } catch (error) {
          logger.error('Error in Anthropic request:', { error })
          throw error
        }

        const accumulatedCost = calculateCost(request.model, tokens.input, tokens.output)

        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          stream: true,
          tool_choice: undefined,
        }

        const streamResponse: any = await anthropic.messages.create(streamingPayload)

        const streamingResult = {
          stream: createReadableStreamFromAnthropicStream(
            streamResponse,
            (streamContent, usage) => {
              streamingResult.execution.output.content = streamContent
              streamingResult.execution.output.tokens = {
                input: tokens.input + usage.input_tokens,
                output: tokens.output + usage.output_tokens,
                total: tokens.total + usage.input_tokens + usage.output_tokens,
              }

              const streamCost = calculateCost(
                request.model,
                usage.input_tokens,
                usage.output_tokens
              )
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

        logger.error('Error in Anthropic request:', {
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

      let currentResponse = await anthropic.messages.create(payload)
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
            const toolArgs = toolUse.input as Record<string, any>

            try {
              const tool = request.tools?.find((t) => t.id === toolName)
              if (!tool) return null

              const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
              const result = await executeTool(toolName, executionParams, true)
              const toolCallEndTime = Date.now()

              return {
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

          for (const settledResult of executionResults) {
            if (settledResult.status === 'rejected' || !settledResult.value) continue

            const { toolName, toolArgs, toolParams, result, startTime, endTime, duration } =
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

            const toolUseId = generateToolUseId(toolName)

            currentMessages.push({
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolName,
                  input: toolArgs,
                } as any,
              ],
            })

            currentMessages.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: JSON.stringify(resultContent),
                } as any,
              ],
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
                type: 'tool',
                name: remainingTools[0],
              }
              logger.info(`Forcing next tool: ${remainingTools[0]}`)
            } else {
              nextPayload.tool_choice = undefined
              logger.info('All forced tools have been used, removing tool_choice parameter')
            }
          } else if (hasUsedForcedTool && typeof originalToolChoice === 'object') {
            nextPayload.tool_choice = undefined
            logger.info(
              'Removing tool_choice parameter for subsequent requests after forced tool was used'
            )
          }

          const nextModelStartTime = Date.now()

          currentResponse = await anthropic.messages.create(nextPayload)

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
        logger.error('Error in Anthropic request:', { error })
        throw error
      }

      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      if (request.stream) {
        logger.info('Using streaming for final Anthropic response after tool processing')

        const streamingPayload = {
          ...payload,
          messages: currentMessages,
          stream: true,
          tool_choice: undefined,
        }

        const streamResponse: any = await anthropic.messages.create(streamingPayload)

        const streamingResult = {
          stream: createReadableStreamFromAnthropicStream(streamResponse, (content, usage) => {
            streamingResult.execution.output.content = content
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
                arguments: tc.arguments as Record<string, any>,
                startTime: tc.startTime,
                endTime: tc.endTime,
                duration: tc.duration,
                result: tc.result,
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

      logger.error('Error in Anthropic request:', {
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
  },
}
