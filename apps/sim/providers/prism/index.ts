import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import OpenAI from 'openai'
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import { formatMessagesForProvider } from '@/providers/attachments'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import { createOpenAICompatStreamingToolLoopStream } from '@/providers/openai-compat/streaming-tool-loop'
import { createReadableStreamFromPrismStream } from '@/providers/prism/utils'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { createStreamingExecution } from '@/providers/streaming-execution'
import type { StreamingToolLoopComplete } from '@/providers/streaming-tool-loop-shared'
import { adaptOpenAIChatToolSchema } from '@/providers/tool-schema-adapter'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'
import { openAICompatTransport } from '@/providers/transport'
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
  enforceStrictSchema,
  isFunctionToolCall,
  prepareToolsWithUsageControl,
} from '@/providers/utils'

const logger = createLogger('PrismProvider')

export const PRISM_BASE_URL = 'https://api.prisminference.com/v1'

type PrismReasoningEffort = 'none' | 'low' | 'medium' | 'high'

type PrismPayload = ChatCompletionCreateParamsNonStreaming & {
  reasoning_effort?: PrismReasoningEffort
}

function buildResponseFormat(request: ProviderRequest): PrismPayload['response_format'] {
  if (!request.responseFormat) return undefined
  const isStrict = request.responseFormat.strict !== false
  return {
    type: 'json_schema',
    json_schema: {
      name: request.responseFormat.name || 'response_schema',
      schema: isStrict
        ? enforceStrictSchema(request.responseFormat.schema)
        : request.responseFormat.schema,
      strict: isStrict,
    },
  }
}

function getReasoningEffort(value: string | undefined): PrismReasoningEffort | undefined {
  if (!value || value === 'auto') return undefined
  if (value === 'none' || value === 'low' || value === 'medium' || value === 'high') return value
  throw new Error(`Unsupported Prism reasoning effort: ${value}`)
}

async function drainStream(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader()
  while (!(await reader.read()).done) {}
}

export const prismProvider: ProviderConfig = {
  id: 'prism',
  name: 'Prism',
  description: 'Prism provides open-source model inference',
  version: '1.0.0',
  models: getProviderModels('prism'),
  defaultModel: getProviderDefaultModel('prism'),

  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) {
      throw new Error('API key is required for Prism')
    }

    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    try {
      const prism = new OpenAI({
        ...openAICompatTransport(),
        apiKey: request.apiKey,
        baseURL: PRISM_BASE_URL,
      })
      const allMessages: Message[] = []
      if (request.systemPrompt) allMessages.push({ role: 'system', content: request.systemPrompt })
      if (request.context) allMessages.push({ role: 'user', content: request.context })
      if (request.messages) allMessages.push(...request.messages)

      const formattedMessages = formatMessagesForProvider(allMessages, 'prism')
      // double-cast-allowed: the attachment formatter returns provider-neutral messages that match OpenAI chat message params for this text-only adapter
      const messages = formattedMessages as unknown as ChatCompletionMessageParam[]
      const payload: PrismPayload = {
        model: request.model,
        messages,
      }
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens != null) payload.max_tokens = request.maxTokens
      const reasoningEffort = getReasoningEffort(request.reasoningEffort)
      if (reasoningEffort) payload.reasoning_effort = reasoningEffort
      const responseFormat = buildResponseFormat(request)
      if (responseFormat) payload.response_format = responseFormat

      const tools = request.tools?.length
        ? request.tools.map((tool) => adaptOpenAIChatToolSchema(tool))
        : undefined
      const preparedTools = tools?.length
        ? prepareToolsWithUsageControl(tools, request.tools, logger, 'openai')
        : null
      if (preparedTools?.tools?.length) {
        payload.tools = preparedTools.tools
        const toolChoice = preparedTools.toolChoice
        if (
          toolChoice === 'auto' ||
          toolChoice === 'none' ||
          (typeof toolChoice === 'object' && toolChoice.type === 'function')
        ) {
          payload.tool_choice = toolChoice
        }
      }

      if (payload.tools?.length) {
        const timeSegments: TimeSegment[] = []
        const completed: { value?: StreamingToolLoopComplete } = {}
        const createToolStream = () =>
          createOpenAICompatStreamingToolLoopStream({
            providerName: 'Prism',
            request,
            basePayload: { ...payload },
            messages,
            createStream: (params, options) =>
              prism.chat.completions.create(
                {
                  ...params,
                  stream: true,
                  stream_options: { include_usage: true },
                },
                options
              ),
            logger,
            timeSegments,
            forcedTools: preparedTools?.forcedTools,
            preserveAssistantReasoning: true,
            onComplete: (result) => {
              completed.value = result
            },
          })

        if (request.stream) {
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
            initialCost: { input: 0, output: 0, total: 0 },
            isStreaming: true,
            streamFormat: 'agent-events-v1',
            createStream: ({ output, finalizeTiming }) => {
              const stream = createToolStream()
              const updateOutput = () => {
                const result = completed.value
                if (!result) return
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
              }
              return stream.pipeThrough(
                new TransformStream<AgentStreamEvent, AgentStreamEvent>({
                  transform(event, controller) {
                    controller.enqueue(event)
                  },
                  flush: updateOutput,
                })
              )
            },
          })
        }

        await drainStream(createToolStream())
        const result = completed.value
        if (!result) throw new Error('Prism tool stream ended without a result')
        const modelCost = calculateCost(request.model, result.tokens.input, result.tokens.output)
        const toolCost = result.cost?.toolCost
        return {
          content: result.content,
          model: request.model,
          tokens: result.tokens,
          cost: {
            ...modelCost,
            ...(toolCost !== undefined ? { toolCost } : {}),
            total: modelCost.total + (toolCost ?? 0),
          },
          toolCalls: result.toolCalls?.list as FunctionCallResponse[] | undefined,
          toolResults: result.toolResults,
          timing: {
            startTime: providerStartTimeISO,
            endTime: new Date().toISOString(),
            duration: Date.now() - providerStartTime,
            modelTime: result.modelTime,
            toolsTime: result.toolsTime,
            firstResponseTime: result.firstResponseTime,
            iterations: result.iterations,
            timeSegments,
          },
        }
      }

      if (request.stream) {
        const streamResponse = await prism.chat.completions.create(
          {
            ...payload,
            stream: true,
            stream_options: { include_usage: true },
          } as ChatCompletionCreateParamsStreaming,
          request.abortSignal ? { signal: request.abortSignal } : undefined
        )
        return createStreamingExecution({
          model: request.model,
          providerStartTime,
          providerStartTimeISO,
          timing: { kind: 'simple', segmentName: request.model },
          initialTokens: { input: 0, output: 0, total: 0 },
          initialCost: { input: 0, output: 0, total: 0 },
          isStreaming: true,
          streamFormat: 'agent-events-v1',
          createStream: ({ output, finalizeTiming }) =>
            createReadableStreamFromPrismStream(streamResponse, (content, usage, thinking) => {
              output.content = content
              output.tokens = {
                input: usage.prompt_tokens,
                output: usage.completion_tokens,
                total: usage.total_tokens,
              }
              output.cost = calculateCost(
                request.model,
                usage.prompt_tokens,
                usage.completion_tokens
              )
              if (thinking) {
                const segment = output.providerTiming?.timeSegments?.[0]
                if (segment) segment.thinkingContent = thinking
              }
              finalizeTiming()
            }),
        })
      }

      const responseStartTime = Date.now()
      const response = await prism.chat.completions.create(
        payload,
        request.abortSignal ? { signal: request.abortSignal } : undefined
      )
      const responseEndTime = Date.now()
      const usage = response.usage
      const tokens = {
        input: usage?.prompt_tokens ?? 0,
        output: usage?.completion_tokens ?? 0,
        total: usage?.total_tokens ?? 0,
      }
      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: request.model,
          startTime: responseStartTime,
          endTime: responseEndTime,
          duration: responseEndTime - responseStartTime,
        },
      ]
      enrichLastModelSegmentFromChatCompletions(
        timeSegments,
        response,
        response.choices[0]?.message?.tool_calls?.filter(isFunctionToolCall),
        {
          model: request.model,
          provider: 'prism',
        }
      )
      return {
        content: response.choices[0]?.message?.content ?? '',
        model: request.model,
        tokens,
        cost: calculateCost(request.model, tokens.input, tokens.output),
        timing: {
          startTime: providerStartTimeISO,
          endTime: new Date(responseEndTime).toISOString(),
          duration: responseEndTime - providerStartTime,
          modelTime: responseEndTime - responseStartTime,
          firstResponseTime: responseEndTime - responseStartTime,
          iterations: 1,
          timeSegments,
        },
      }
    } catch (error) {
      const endTime = Date.now()
      throw new ProviderError(
        `Prism API error: ${toError(error).message}`,
        {
          startTime: providerStartTimeISO,
          endTime: new Date(endTime).toISOString(),
          duration: endTime - providerStartTime,
        },
        { cause: error }
      )
    }
  },
}
