import {
  type Message as BedrockMessage,
  BedrockRuntimeClient,
  type BedrockRuntimeClientConfig,
  type ContentBlock,
  type ConversationRole,
  ConverseCommand,
  type ConverseResponse,
  ConverseStreamCommand,
  type OutputConfig,
  type SystemContentBlock,
  type Tool,
  type ToolConfiguration,
  type ToolResultBlock,
  type ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { IterationToolCall, NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { buildBedrockMessageContent } from '@/providers/attachments'
import { createBedrockStreamingToolLoopStream } from '@/providers/bedrock/streaming-tool-loop'
import {
  checkForForcedToolUsage,
  createReadableStreamFromBedrockStream,
  generateToolUseId,
  getBedrockInferenceProfileId,
} from '@/providers/bedrock/utils'
import { getCachedProviderClient } from '@/providers/client-cache'
import {
  getProviderDefaultModel,
  getProviderModels,
  supportsNativeStructuredOutputs,
} from '@/providers/models'
import { createSettledAgentEventStream } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'
import { isAbortError, parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import { enrichLastModelSegment } from '@/providers/trace-enrichment'
import type {
  FunctionCallResponse,
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

const logger = createLogger('BedrockProvider')

function enrichLastModelSegmentFromBedrockResponse(
  timeSegments: TimeSegment[],
  response: ConverseResponse,
  extras: { model: string }
): void {
  const blocks: ContentBlock[] = response.output?.message?.content ?? []

  const assistantText = blocks
    .filter((b): b is ContentBlock & { text: string } => 'text' in b && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
  const assistantContent = assistantText.length > 0 ? assistantText : undefined

  const toolCalls: IterationToolCall[] = blocks
    .filter((b): b is ContentBlock & { toolUse: ToolUseBlock } => 'toolUse' in b && !!b.toolUse)
    .map((b) => {
      const input = b.toolUse.input
      return {
        id: b.toolUse.toolUseId ?? '',
        name: b.toolUse.name ?? '',
        arguments:
          input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {},
      }
    })

  const inputTokens = response.usage?.inputTokens
  const outputTokens = response.usage?.outputTokens

  let cost: { input: number; output: number; total: number } | undefined
  if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
    const full = calculateCost(extras.model, inputTokens, outputTokens)
    cost = { input: full.input, output: full.output, total: full.total }
  }

  enrichLastModelSegment(timeSegments, {
    assistantContent,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: response.stopReason ?? undefined,
    tokens:
      inputTokens !== undefined || outputTokens !== undefined
        ? {
            input: inputTokens,
            output: outputTokens,
            total:
              typeof inputTokens === 'number' && typeof outputTokens === 'number'
                ? inputTokens + outputTokens
                : undefined,
          }
        : undefined,
    cost,
    provider: 'aws.bedrock',
  })
}

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
    const region = request.bedrockRegion || 'us-east-1'
    const bedrockModelId = getBedrockInferenceProfileId(request.model, region)

    logger.info('Bedrock request', {
      requestModel: request.model,
      inferenceProfileId: bedrockModelId,
      region,
    })

    const hasAccessKey = Boolean(request.bedrockAccessKeyId)
    const hasSecretKey = Boolean(request.bedrockSecretKey)
    if (hasAccessKey !== hasSecretKey) {
      throw new Error(
        'Both bedrockAccessKeyId and bedrockSecretKey must be provided together. ' +
          'Provide both for explicit credentials, or omit both to use the AWS default credential chain.'
      )
    }

    const clientConfig: BedrockRuntimeClientConfig = { region }
    if (request.bedrockAccessKeyId && request.bedrockSecretKey) {
      clientConfig.credentials = {
        accessKeyId: request.bedrockAccessKeyId,
        secretAccessKey: request.bedrockSecretKey,
      }
    }

    // Key on the full credential (access key id + secret) so a corrected secret
    // under the same access key id yields a fresh client rather than a stale one.
    const credentialKey =
      request.bedrockAccessKeyId && request.bedrockSecretKey
        ? `${request.bedrockAccessKeyId}:${request.bedrockSecretKey}`
        : 'default-chain'
    const client = getCachedProviderClient(
      `bedrock::${region}::${credentialKey}`,
      () => new BedrockRuntimeClient(clientConfig)
    )

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
              input: parseToolArguments(toolCall.arguments, toolCall.name) as ToolUseBlock['input'],
            }
            messages.push({
              role: 'assistant' as ConversationRole,
              content: [{ toolUse: toolUseBlock }],
            })
          }
        } else {
          const role: ConversationRole = msg.role === 'assistant' ? 'assistant' : 'user'
          const content = buildBedrockMessageContent(msg.content, msg.files, 'bedrock')
          messages.push({
            role,
            // double-cast-allowed: shared attachment builder emits Bedrock Converse content blocks while keeping provider-neutral attachment types
            content: content as unknown as ContentBlock[],
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
    let outputConfig: OutputConfig | undefined
    const structuredOutputToolName = 'structured_output'

    if (request.responseFormat) {
      const schema = request.responseFormat.schema || request.responseFormat
      const schemaName = request.responseFormat.name || 'response'

      if (supportsNativeStructuredOutputs(request.model) && !request.tools?.length) {
        outputConfig = {
          textFormat: {
            type: 'json_schema',
            structure: {
              jsonSchema: {
                name: schemaName,
                schema: JSON.stringify(schema),
              },
            },
          },
        }
        logger.info(`Using native structured outputs: ${schemaName}`)
      } else {
        structuredOutputTool = {
          toolSpec: {
            name: structuredOutputToolName,
            description: `Output the response as structured JSON matching the ${schemaName} schema. You MUST call this tool to provide your final response.`,
            inputSchema: {
              json: schema,
            },
          },
        }
        logger.info(`Using tool-based structured outputs: ${schemaName}`)
      }
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

      const { tools: filteredTools, toolChoice: preparedToolChoice } = preparedTools
      bedrockTools = filteredTools?.length
        ? filteredTools.map((tool) => ({
            toolSpec: {
              name: tool.name,
              description: tool.description,
              inputSchema: { json: tool.input_schema },
            },
          }))
        : undefined

      if (bedrockTools?.length) {
        if (preparedToolChoice === 'auto') {
          toolChoice = { auto: {} }
        } else if (preparedToolChoice === 'none') {
          toolChoice = undefined
          bedrockTools = undefined
        } else if (
          preparedToolChoice?.type === 'tool' &&
          typeof preparedToolChoice.name === 'string' &&
          preparedToolChoice.name.length > 0
        ) {
          toolChoice = { tool: { name: preparedToolChoice.name } }
          logger.info(`Using Bedrock tool_choice format: force tool "${preparedToolChoice.name}"`)
        } else if (
          preparedToolChoice?.type === 'function' &&
          typeof preparedToolChoice.function?.name === 'string' &&
          preparedToolChoice.function.name.length > 0
        ) {
          toolChoice = { tool: { name: preparedToolChoice.function.name } }
          logger.info(
            `Using Bedrock tool_choice format: force tool "${preparedToolChoice.function.name}"`
          )
        } else if (preparedToolChoice?.type === 'any') {
          toolChoice = { any: {} }
          logger.info('Using Bedrock tool_choice format: any tool')
        } else {
          throw new Error('Invalid Bedrock tool choice returned by tool preparation')
        }
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

    /**
     * The live tool loop cannot honor responseFormat — structured output on
     * Bedrock rides a final forced `structured_output` tool call that only the
     * silent loop performs — so those requests fall back to the silent path.
     */
    const liveToolLoopSupported = !request.responseFormat

    if (request.stream && liveToolLoopSupported && bedrockTools && bedrockTools.length > 0) {
      logger.info('Using streaming tool loop for Bedrock request')

      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()
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
          createBedrockStreamingToolLoopStream({
            client,
            modelId: bedrockModelId,
            request,
            messages,
            system: systemPromptWithSchema.length > 0 ? systemPromptWithSchema : undefined,
            inferenceConfig,
            bedrockTools,
            toolChoice,
            logger,
            timeSegments,
            forcedTools,
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

    if (request.stream && (!bedrockTools || bedrockTools.length === 0)) {
      logger.info('Using streaming response for Bedrock request (no tools)')

      const providerStartTime = Date.now()
      const providerStartTimeISO = new Date(providerStartTime).toISOString()

      const command = new ConverseStreamCommand({
        modelId: bedrockModelId,
        messages,
        system: systemPromptWithSchema.length > 0 ? systemPromptWithSchema : undefined,
        inferenceConfig,
        outputConfig,
      })

      const streamResponse = await client.send(
        command,
        request.abortSignal ? { abortSignal: request.abortSignal } : undefined
      )

      if (!streamResponse.stream) {
        throw new Error('No stream returned from Bedrock')
      }

      const bedrockStream = streamResponse.stream
      const streamingResult = createStreamingExecution({
        model: request.model,
        providerStartTime,
        providerStartTimeISO,
        timing: { kind: 'simple', segmentName: request.model },
        initialTokens: { input: 0, output: 0, total: 0 },
        initialCost: { total: 0.0, input: 0.0, output: 0.0 },
        isStreaming: true,
        streamFormat: 'agent-events-v1',
        createStream: ({ output, finalizeTiming }) =>
          createReadableStreamFromBedrockStream(bedrockStream, (content, usage) => {
            output.content = content
            output.tokens = {
              input: usage.inputTokens,
              output: usage.outputTokens,
              total: usage.inputTokens + usage.outputTokens,
            }

            const costResult = calculateCost(request.model, usage.inputTokens, usage.outputTokens)
            output.cost = {
              input: costResult.input,
              output: costResult.output,
              total: costResult.total,
            }

            finalizeTiming()
          }),
      })

      return streamingResult
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
        outputConfig,
        toolConfig,
      })

      let currentResponse = await client.send(
        command,
        request.abortSignal ? { abortSignal: request.abortSignal } : undefined
      )
      const firstResponseTime = Date.now() - initialCallTime

      let content = ''
      if (currentResponse.output?.message?.content) {
        const structuredOutputCall = currentResponse.output.message.content.find(
          (block): block is ContentBlock & { toolUse: ToolUseBlock } =>
            'toolUse' in block && block.toolUse?.name === structuredOutputToolName
        )

        if (structuredOutputCall && structuredOutputTool) {
          content = JSON.stringify(structuredOutputCall.toolUse.input, null, 2)
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

      const toolCalls: FunctionCallResponse[] = []
      const toolResults: Record<string, unknown>[] = []
      const currentMessages = [...messages]
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

      enrichLastModelSegmentFromBedrockResponse(timeSegments, currentResponse, {
        model: request.model,
      })

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

        if (currentToolUses.length > 0 && currentResponse.stopReason !== 'tool_use') {
          throw new Error(
            `Bedrock returned tool use with stop reason ${currentResponse.stopReason ?? 'missing'}`
          )
        }
        if (currentToolUses.length === 0) {
          break
        }

        const toolsStartTime = Date.now()

        const toolExecutionPromises = currentToolUses.map(async (toolUse: ToolUseBlock) => {
          const toolCallStartTime = Date.now()
          const toolName = toolUse.name || ''
          const toolArgs =
            toolUse.input && typeof toolUse.input === 'object' && !Array.isArray(toolUse.input)
              ? (toolUse.input as Record<string, unknown>)
              : undefined
          const toolUseId = toolUse.toolUseId || generateToolUseId(toolName)

          try {
            if (!toolArgs) {
              throw new Error(`Arguments for tool "${toolName}" must be an object`)
            }

            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) {
              const toolCallEndTime = Date.now()
              return {
                toolUseId,
                toolName,
                toolArgs,
                toolParams: {},
                result: {
                  success: false,
                  output: undefined,
                  error: `Tool not found: ${toolName}`,
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
              toolUseId,
              toolName,
              toolArgs: toolArgs ?? {},
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
              toolUseId,
              toolName,
              toolArgs,
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

        const assistantContent: ContentBlock[] = currentResponse.output?.message?.content ?? []
        currentMessages.push({
          role: 'assistant' as ConversationRole,
          content: assistantContent,
        })

        const toolResultContent: ContentBlock[] = []

        for (const executionResult of executionResults) {
          const {
            toolUseId,
            toolName,
            toolArgs,
            toolParams,
            result,
            startTime,
            endTime,
            duration,
          } = executionResult

          timeSegments.push({
            type: 'tool',
            name: toolName,
            startTime,
            endTime,
            duration,
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
            duration,
            result: resultContent,
            success: result.success,
          })

          const toolResultBlock: ToolResultBlock = {
            toolUseId,
            content: [{ text: JSON.stringify(resultContent) }],
            status: result.success ? 'success' : 'error',
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

        currentResponse = await client.send(
          nextCommand,
          request.abortSignal ? { abortSignal: request.abortSignal } : undefined
        )

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
          name: request.model,
          startTime: nextModelStartTime,
          endTime: nextModelEndTime,
          duration: thisModelTime,
        })

        enrichLastModelSegmentFromBedrockResponse(timeSegments, currentResponse, {
          model: request.model,
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

        const structuredResponse = await client.send(
          structuredOutputCommand,
          request.abortSignal ? { abortSignal: request.abortSignal } : undefined
        )
        const structuredOutputEndTime = Date.now()

        timeSegments.push({
          type: 'model',
          name: 'Structured output extraction',
          startTime: structuredOutputStartTime,
          endTime: structuredOutputEndTime,
          duration: structuredOutputEndTime - structuredOutputStartTime,
        })

        enrichLastModelSegmentFromBedrockResponse(timeSegments, structuredResponse, {
          model: request.model,
        })

        modelTime += structuredOutputEndTime - structuredOutputStartTime

        const structuredOutputCall = structuredResponse.output?.message?.content?.find(
          (block): block is ContentBlock & { toolUse: ToolUseBlock } =>
            'toolUse' in block && block.toolUse?.name === structuredOutputToolName
        )

        if (structuredOutputCall) {
          content = JSON.stringify(structuredOutputCall.toolUse.input, null, 2)
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

      if (request.stream && !liveToolLoopSupported) {
        logger.info('Projecting settled Bedrock response after tool processing')
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
          initialTokens: { input: tokens.input, output: tokens.output, total: tokens.total },
          initialCost: {
            input: cost.input,
            output: cost.output,
            toolCost: toolCost || undefined,
            total: cost.total + toolCost,
          },
          toolCalls:
            toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
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
          iterations: timeSegments.filter((segment) => segment.type === 'model').length,
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
