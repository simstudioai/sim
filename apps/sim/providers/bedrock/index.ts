import {
  type Message as BedrockMessage,
  BedrockRuntimeClient,
  type ContentBlock,
  type ConversationRole,
  ConverseCommand,
  ConverseStreamCommand,
  type SystemContentBlock,
  type Tool,
  type ToolConfiguration,
  type ToolResultBlock,
  type ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime'
import { createLogger } from '@sim/logger'
import type { StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import {
  checkForForcedToolUsage,
  createReadableStreamFromBedrockStream,
  generateToolUseId,
  getBedrockInferenceProfileId,
} from '@/providers/bedrock/utils'
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
} from '@/providers/utils'
import { executeTool } from '@/tools'

const logger = createLogger('BedrockProvider')

export const bedrockProvider: ProviderConfig = {
  id: 'bedrock',
  name: 'AWS Bedrock',
  description: 'AWS Bedrock foundation models',
  version: '1.0.0',
  models: getProviderModels('bedrock'),
  defaultModel: getProviderDefaultModel('bedrock'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.bedrockAccessKeyId) {
      throw new Error('AWS Access Key ID is required for Bedrock')
    }

    if (!request.bedrockSecretKey) {
      throw new Error('AWS Secret Access Key is required for Bedrock')
    }

    const region = request.bedrockRegion || 'us-east-1'
    const bedrockModelId = getBedrockInferenceProfileId(request.model, region)

    logger.info('Bedrock request', {
      requestModel: request.model,
      inferenceProfileId: bedrockModelId,
      region,
    })

    const client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId: request.bedrockAccessKeyId || '',
        secretAccessKey: request.bedrockSecretKey || '',
      },
    })

    const messages: BedrockMessage[] = []
    const systemContent: SystemContentBlock[] = []

    if (request.systemPrompt) {
      systemContent.push({ text: request.systemPrompt })
    }

    if (request.context) {
      messages.push({
        role: 'user' as ConversationRole,
        content: [{ text: request.context }],
      })
    }

    if (request.messages) {
      for (const msg of request.messages) {
        if (msg.role === 'function' || msg.role === 'tool') {
          const toolResultBlock: ToolResultBlock = {
            toolUseId: msg.tool_call_id || msg.name || generateToolUseId('tool'),
            content: [{ text: msg.content || '' }],
          }
          messages.push({
            role: 'user' as ConversationRole,
            content: [{ toolResult: toolResultBlock }],
          })
        } else if (msg.function_call || msg.tool_calls) {
          const toolCall = msg.function_call || msg.tool_calls?.[0]?.function
          if (toolCall) {
            const toolUseBlock: ToolUseBlock = {
              toolUseId: msg.tool_calls?.[0]?.id || generateToolUseId(toolCall.name),
              name: toolCall.name,
              input: JSON.parse(toolCall.arguments),
            }
            messages.push({
              role: 'assistant' as ConversationRole,
              content: [{ toolUse: toolUseBlock }],
            })
          }
        } else {
          const role: ConversationRole = msg.role === 'assistant' ? 'assistant' : 'user'
          messages.push({
            role,
            content: [{ text: msg.content || '' }],
          })
        }
      }
    }

    if (messages.length === 0) {
      messages.push({
        role: 'user' as ConversationRole,
        content: [{ text: request.systemPrompt || 'Hello' }],
      })
      systemContent.length = 0
    }

    let structuredOutputTool: Tool | undefined
    const structuredOutputToolName = 'structured_output'

    if (request.responseFormat) {
      const schema = request.responseFormat.schema || request.responseFormat
      const schemaName = request.responseFormat.name || 'response'

      structuredOutputTool = {
        toolSpec: {
          name: structuredOutputToolName,
          description: `Output the response as structured JSON matching the ${schemaName} schema. You MUST call this tool to provide your final response.`,
          inputSchema: {
            json: schema,
          },
        },
      }

      logger.info(`Using Tool Use approach for structured outputs: ${schemaName}`)
    }

    let bedrockTools: Tool[] | undefined
    let toolChoice: any = { auto: {} }
    let preparedTools: ReturnType<typeof prepareToolsWithUsageControl> | null = null

    if (request.tools?.length) {
      bedrockTools = request.tools.map((tool) => ({
        toolSpec: {
          name: tool.id,
          description: tool.description,
          inputSchema: {
            json: {
              type: 'object',
              properties: tool.parameters.properties,
              required: tool.parameters.required,
            },
          },
        },
      }))

      try {
        preparedTools = prepareToolsWithUsageControl(
          bedrockTools.map((t) => ({
            name: t.toolSpec?.name || '',
            description: t.toolSpec?.description || '',
            input_schema: t.toolSpec?.inputSchema?.json,
          })),
          request.tools,
          logger,
          'bedrock'
        )

        const { tools: filteredTools, toolChoice: tc } = preparedTools

        if (filteredTools?.length) {
          bedrockTools = filteredTools.map((t: any) => ({
            toolSpec: {
              name: t.name,
              description: t.description,
              inputSchema: { json: t.input_schema },
            },
          }))

          if (typeof tc === 'object' && tc !== null) {
            if (tc.type === 'tool' && tc.name) {
              toolChoice = { tool: { name: tc.name } }
              logger.info(`Using Bedrock tool_choice format: force tool "${tc.name}"`)
            } else if (tc.type === 'function' && tc.function?.name) {
              toolChoice = { tool: { name: tc.function.name } }
              logger.info(`Using Bedrock tool_choice format: force tool "${tc.function.name}"`)
            } else if (tc.type === 'any') {
              toolChoice = { any: {} }
              logger.info('Using Bedrock tool_choice format: any tool')
            } else {
              toolChoice = { auto: {} }
            }
          } else if (tc === 'none') {
            toolChoice = undefined
            bedrockTools = undefined
          } else {
            toolChoice = { auto: {} }
          }
        }
      } catch (error) {
        logger.error('Error in prepareToolsWithUsageControl:', { error })
        toolChoice = { auto: {} }
      }
    } else if (structuredOutputTool) {
      bedrockTools = [structuredOutputTool]
      toolChoice = { tool: { name: structuredOutputToolName } }
      logger.info('Using structured_output tool as only tool (forced)')
    }

    const hasToolContentInMessages = messages.some((msg) =>
      msg.content?.some(
        (block) =>
          ('toolUse' in block && block.toolUse) || ('toolResult' in block && block.toolResult)
      )
    )

    const toolConfig: ToolConfiguration | undefined = bedrockTools?.length
      ? {
          tools: bedrockTools,
          toolChoice,
        }
      : hasToolContentInMessages && request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              toolSpec: {
                name: tool.id,
                description: tool.description,
                inputSchema: {
                  json: {
                    type: 'object',
                    properties: tool.parameters.properties,
                    required: tool.parameters.required,
                  },
                },
              },
            })),
            toolChoice: { auto: {} },
          }
        : undefined

    if (hasToolContentInMessages && !toolConfig) {
      throw new Error(
        'Messages contain tool use/result blocks but no tools were provided. ' +
          'Bedrock requires toolConfig when processing messages with tool content.'
      )
    }

    const systemPromptWithSchema = systemContent

    const inferenceConfig: { temperature: number; maxTokens?: number } = {
      temperature: Number.parseFloat(String(request.temperature ?? 0.7)),
    }
    if (request.maxTokens != null) {
      inferenceConfig.maxTokens = Number.parseInt(String(request.maxTokens))
    }

    const shouldStreamToolCalls = request.streamToolCalls ?? false

    if (request.stream && (!bedrockTools || bedrockTools.length === 0)) {
      logger.info('Using streaming response for Bedrock request (no tools)')

      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      const command = new ConverseStreamCommand({
        modelId: bedrockModelId,
        messages,
        system: systemPromptWithSchema.length > 0 ? systemPromptWithSchema : undefined,
        inferenceConfig,
      })

      const streamResponse = await client.send(command)

      if (!streamResponse.stream) {
        throw new Error('No stream returned from Bedrock')
      }

      const streamingResult = {
        stream: createReadableStreamFromBedrockStream(streamResponse.stream, (content, usage) => {
          streamingResult.execution.output.content = content
          streamingResult.execution.output.tokens = {
            input: usage.inputTokens,
            output: usage.outputTokens,
            total: usage.inputTokens + usage.outputTokens,
          }

          const costResult = calculateCost(request.model, usage.inputTokens, usage.outputTokens)
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

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const initialCallTime = Date.now()
      const originalToolChoice = toolChoice
      const forcedTools = preparedTools?.forcedTools || []
      let usedForcedTools: string[] = []

      const command = new ConverseCommand({
        modelId: bedrockModelId,
        messages,
        system: systemPromptWithSchema.length > 0 ? systemPromptWithSchema : undefined,
        inferenceConfig,
        toolConfig,
      })

      let currentResponse = await client.send(command)
      const firstResponseTime = Date.now() - initialCallTime

      let content = ''
      let hasExtractedStructuredOutput = false
      if (currentResponse.output?.message?.content) {
        const structuredOutputCall = currentResponse.output.message.content.find(
          (block): block is ContentBlock & { toolUse: ToolUseBlock } =>
            'toolUse' in block && block.toolUse?.name === structuredOutputToolName
        )

        if (structuredOutputCall && structuredOutputTool) {
          content = JSON.stringify(structuredOutputCall.toolUse.input, null, 2)
          hasExtractedStructuredOutput = true
          logger.info('Extracted structured output from tool call')
        } else {
          const textBlocks = currentResponse.output.message.content.filter(
            (block): block is ContentBlock & { text: string } => 'text' in block
          )
          content = textBlocks.map((block) => block.text).join('\n')
        }
      }

      const tokens = {
        input: currentResponse.usage?.inputTokens || 0,
        output: currentResponse.usage?.outputTokens || 0,
        total:
          (currentResponse.usage?.inputTokens || 0) + (currentResponse.usage?.outputTokens || 0),
      }

      const initialCost = calculateCost(
        request.model,
        currentResponse.usage?.inputTokens || 0,
        currentResponse.usage?.outputTokens || 0
      )
      const cost = {
        input: initialCost.input,
        output: initialCost.output,
        total: initialCost.total,
        pricing: initialCost.pricing,
      }

      const toolCalls: any[] = []
      const toolResults: any[] = []
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

      const initialToolUseContentBlocks = (currentResponse.output?.message?.content || []).filter(
        (block): block is ContentBlock & { toolUse: ToolUseBlock } => 'toolUse' in block
      )
      const toolUseBlocks = initialToolUseContentBlocks.map((block) => ({
        name: block.toolUse.name || '',
      }))

      const firstCheckResult = checkForForcedToolUsage(
        toolUseBlocks,
        originalToolChoice,
        forcedTools,
        usedForcedTools
      )
      if (firstCheckResult) {
        hasUsedForcedTool = firstCheckResult.hasUsedForcedTool
        usedForcedTools = firstCheckResult.usedForcedTools
      }

      while (iterationCount < MAX_TOOL_ITERATIONS) {
        const textContentBlocks = (currentResponse.output?.message?.content || []).filter(
          (block): block is ContentBlock & { text: string } => 'text' in block
        )
        const textContent = textContentBlocks.map((block) => block.text).join('\n')

        if (textContent) {
          content = textContent
        }

        const toolUseContentBlocks = (currentResponse.output?.message?.content || []).filter(
          (block): block is ContentBlock & { toolUse: ToolUseBlock } => 'toolUse' in block
        )
        const currentToolUses = toolUseContentBlocks.map((block) => block.toolUse)

        if (!currentToolUses || currentToolUses.length === 0) {
          break
        }

        const toolsStartTime = Date.now()

        const toolExecutionPromises = currentToolUses.map(async (toolUse: ToolUseBlock) => {
          const toolCallStartTime = Date.now()
          const toolName = toolUse.name || ''
          const toolArgs = (toolUse.input as Record<string, any>) || {}
          const toolUseId = toolUse.toolUseId || generateToolUseId(toolName)

          try {
            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) return null

            const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
            const result = await executeTool(toolName, executionParams)
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
                error: error instanceof Error ? error.message : 'Tool execution failed',
              },
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallEndTime - toolCallStartTime,
            }
          }
        })

        const executionResults = await Promise.allSettled(toolExecutionPromises)

        const assistantContent: ContentBlock[] = currentToolUses.map((toolUse: ToolUseBlock) => ({
          toolUse: {
            toolUseId: toolUse.toolUseId,
            name: toolUse.name,
            input: toolUse.input,
          },
        }))
        currentMessages.push({
          role: 'assistant' as ConversationRole,
          content: assistantContent,
        })

        const toolResultContent: ContentBlock[] = []

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
            startTime,
            endTime,
            duration,
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
            duration,
            result: resultContent,
            success: result.success,
          })

          const toolResultBlock: ToolResultBlock = {
            toolUseId,
            content: [{ text: JSON.stringify(resultContent) }],
          }
          toolResultContent.push({ toolResult: toolResultBlock })
        }

        if (toolResultContent.length > 0) {
          currentMessages.push({
            role: 'user' as ConversationRole,
            content: toolResultContent,
          })
        }

        const thisToolsTime = Date.now() - toolsStartTime
        toolsTime += thisToolsTime

        let nextToolChoice = toolChoice
        if (typeof originalToolChoice === 'object' && hasUsedForcedTool && forcedTools.length > 0) {
          const remainingTools = forcedTools.filter((tool) => !usedForcedTools.includes(tool))

          if (remainingTools.length > 0) {
            nextToolChoice = { tool: { name: remainingTools[0] } }
            logger.info(`Forcing next tool: ${remainingTools[0]}`)
          } else {
            nextToolChoice = { auto: {} }
            logger.info('All forced tools have been used, switching to auto')
          }
        } else if (hasUsedForcedTool && typeof originalToolChoice === 'object') {
          nextToolChoice = { auto: {} }
          logger.info('Switching to auto tool choice after forced tool was used')
        }

        const nextModelStartTime = Date.now()

        const nextCommand = new ConverseCommand({
          modelId: bedrockModelId,
          messages: currentMessages,
          system: systemPromptWithSchema.length > 0 ? systemPromptWithSchema : undefined,
          inferenceConfig,
          toolConfig: bedrockTools?.length
            ? { tools: bedrockTools, toolChoice: nextToolChoice }
            : undefined,
        })

        currentResponse = await client.send(nextCommand)

        const nextToolUseContentBlocks = (currentResponse.output?.message?.content || []).filter(
          (block): block is ContentBlock & { toolUse: ToolUseBlock } => 'toolUse' in block
        )
        const nextToolUseBlocks = nextToolUseContentBlocks.map((block) => ({
          name: block.toolUse.name || '',
        }))

        const nextCheckResult = checkForForcedToolUsage(
          nextToolUseBlocks,
          nextToolChoice,
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
          tokens.input += currentResponse.usage.inputTokens || 0
          tokens.output += currentResponse.usage.outputTokens || 0
          tokens.total +=
            (currentResponse.usage.inputTokens || 0) + (currentResponse.usage.outputTokens || 0)

          const iterationCost = calculateCost(
            request.model,
            currentResponse.usage.inputTokens || 0,
            currentResponse.usage.outputTokens || 0
          )
          cost.input += iterationCost.input
          cost.output += iterationCost.output
          cost.total += iterationCost.total
        }

        iterationCount++
      }

      if (structuredOutputTool && request.tools?.length) {
        logger.info('Making final call with forced structured_output tool')

        const structuredOutputStartTime = Date.now()

        const structuredOutputCommand = new ConverseCommand({
          modelId: bedrockModelId,
          messages: currentMessages,
          system: systemPromptWithSchema.length > 0 ? systemPromptWithSchema : undefined,
          inferenceConfig,
          toolConfig: {
            tools: [structuredOutputTool],
            toolChoice: { tool: { name: structuredOutputToolName } },
          },
        })

        const structuredResponse = await client.send(structuredOutputCommand)
        const structuredOutputEndTime = Date.now()

        timeSegments.push({
          type: 'model',
          name: 'Structured output extraction',
          startTime: structuredOutputStartTime,
          endTime: structuredOutputEndTime,
          duration: structuredOutputEndTime - structuredOutputStartTime,
        })

        modelTime += structuredOutputEndTime - structuredOutputStartTime

        const structuredOutputCall = structuredResponse.output?.message?.content?.find(
          (block): block is ContentBlock & { toolUse: ToolUseBlock } =>
            'toolUse' in block && block.toolUse?.name === structuredOutputToolName
        )

        if (structuredOutputCall) {
          content = JSON.stringify(structuredOutputCall.toolUse.input, null, 2)
          hasExtractedStructuredOutput = true
          logger.info('Extracted structured output from forced tool call')
        } else {
          logger.warn('Structured output tool was forced but no tool call found in response')
        }

        if (structuredResponse.usage) {
          tokens.input += structuredResponse.usage.inputTokens || 0
          tokens.output += structuredResponse.usage.outputTokens || 0
          tokens.total +=
            (structuredResponse.usage.inputTokens || 0) +
            (structuredResponse.usage.outputTokens || 0)

          const structuredCost = calculateCost(
            request.model,
            structuredResponse.usage.inputTokens || 0,
            structuredResponse.usage.outputTokens || 0
          )
          cost.input += structuredCost.input
          cost.output += structuredCost.output
          cost.total += structuredCost.total
        }
      }

      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      if (request.stream && !shouldStreamToolCalls && !hasExtractedStructuredOutput) {
        logger.info('Using streaming for final Bedrock response after tool processing')

        const messagesHaveToolContent = currentMessages.some((msg) =>
          msg.content?.some(
            (block) =>
              ('toolUse' in block && block.toolUse) || ('toolResult' in block && block.toolResult)
          )
        )

        const streamToolConfig: ToolConfiguration | undefined =
          messagesHaveToolContent && request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  toolSpec: {
                    name: tool.id,
                    description: tool.description,
                    inputSchema: {
                      json: {
                        type: 'object',
                        properties: tool.parameters.properties,
                        required: tool.parameters.required,
                      },
                    },
                  },
                })),
                toolChoice: { auto: {} },
              }
            : undefined

        const streamCommand = new ConverseStreamCommand({
          modelId: bedrockModelId,
          messages: currentMessages,
          system: systemPromptWithSchema.length > 0 ? systemPromptWithSchema : undefined,
          inferenceConfig,
          toolConfig: streamToolConfig,
        })

        const streamResponse = await client.send(streamCommand)

        if (!streamResponse.stream) {
          throw new Error('No stream returned from Bedrock')
        }

        const streamingResult = {
          stream: createReadableStreamFromBedrockStream(
            streamResponse.stream,
            (streamContent, usage) => {
              streamingResult.execution.output.content = streamContent
              streamingResult.execution.output.tokens = {
                input: tokens.input + usage.inputTokens,
                output: tokens.output + usage.outputTokens,
                total: tokens.total + usage.inputTokens + usage.outputTokens,
              }

              const streamCost = calculateCost(request.model, usage.inputTokens, usage.outputTokens)
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
                modelTime,
                toolsTime,
                firstResponseTime,
                iterations: iterationCount + 1,
                timeSegments,
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
        cost: {
          input: cost.input,
          output: cost.output,
          total: cost.total,
          pricing: cost.pricing,
        },
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
          modelTime,
          toolsTime,
          firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments,
        },
      }
    } catch (error) {
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      logger.error('Error in Bedrock request:', {
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
