import type { Logger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type OpenAI from 'openai'
import { MAX_TOOL_ITERATIONS } from '@/providers'
import { enrichLastModelSegmentFromOpenAIResponse } from '@/providers/openai/trace'
import {
  extractResponseText,
  extractResponseToolCalls,
  isMaxOutputTokensIncompleteResponse,
  isResponseFunctionCallEvent,
  iterateResponsesStreamEvents,
  parseResponsesUsage,
  type ResponsesInputItem,
  type ResponsesToolCall,
  type ResponsesToolChoice,
  responseContainsFunctionCall,
} from '@/providers/openai/utils'
import type { AgentStreamEvent, ToolCallEndStatus } from '@/providers/stream-events'
import {
  isAbortError,
  parseToolArguments,
  type StreamingToolLoopComplete,
  settleOpenTools,
} from '@/providers/streaming-tool-loop-shared'
import type { ProviderRequest, TimeSegment } from '@/providers/types'
import { calculateCost, prepareToolExecution, sumToolCosts } from '@/providers/utils'
import { executeTool } from '@/tools'

export type CreateOpenAIResponsesStream = (
  input: ResponsesInputItem[],
  overrides: Record<string, unknown>,
  abortSignal: AbortSignal
) => Promise<Response>

export interface CreateOpenAIResponsesStreamingToolLoopOptions {
  providerId: string
  providerLabel: string
  request: ProviderRequest
  initialInput: ResponsesInputItem[]
  initialToolChoice?: ResponsesToolChoice
  forcedTools?: string[]
  createStream: CreateOpenAIResponsesStream
  logger: Logger
  timeSegments: TimeSegment[]
  onComplete: (result: StreamingToolLoopComplete) => void
}

interface OpenAIResponsesTurn {
  response: OpenAI.Responses.Response
  text: string
  toolCalls: ResponsesToolCall[]
}

interface OpenAIToolExecutionResult {
  toolCall: ResponsesToolCall
  toolName: string
  toolParams: Record<string, unknown>
  result: {
    success: boolean
    output?: Record<string, unknown>
    error?: string
  }
  startTime: number
  endTime: number
  duration: number
}

/**
 * Streams one OpenAI Responses turn and returns its assembled terminal response.
 */
async function streamResponsesTurn(
  response: Response,
  controller: ReadableStreamDefaultController<AgentStreamEvent>,
  openTools: Map<string, string>,
  abortSignal?: AbortSignal
): Promise<OpenAIResponsesTurn> {
  let terminalResponse: OpenAI.Responses.Response | undefined
  let streamedText = ''
  let sawFunctionCall = false

  for await (const event of iterateResponsesStreamEvents(response, abortSignal)) {
    if (isResponseFunctionCallEvent(event)) {
      sawFunctionCall = true
    }
    if (event.type === 'error') {
      throw new Error(event.message || 'OpenAI Responses stream error')
    }
    if (event.type === 'response.failed') {
      throw new Error(event.response.error?.message || 'OpenAI Responses stream failed')
    }
    if (event.type === 'response.incomplete') {
      const reason = event.response.incomplete_details?.reason ?? 'unknown'
      if (
        !isMaxOutputTokensIncompleteResponse(event.response) ||
        sawFunctionCall ||
        openTools.size > 0 ||
        responseContainsFunctionCall(event.response)
      ) {
        throw new Error(`OpenAI Responses stream incomplete: ${reason}`)
      }
      terminalResponse = event.response
      continue
    }

    if (event.type === 'response.reasoning_summary_text.delta') {
      if (event.delta) {
        controller.enqueue({ type: 'thinking_delta', text: event.delta })
      }
      continue
    }

    if (event.type === 'response.output_text.delta') {
      if (event.delta) {
        streamedText += event.delta
        controller.enqueue({ type: 'text_delta', text: event.delta, turn: 'pending' })
      }
      continue
    }
    if (event.type === 'response.refusal.delta') {
      if (event.delta) {
        streamedText += event.delta
        controller.enqueue({ type: 'text_delta', text: event.delta, turn: 'pending' })
      }
      continue
    }

    if (event.type === 'response.output_item.added' && event.item.type === 'function_call') {
      const id = event.item.call_id
      const name = event.item.name
      if (!openTools.has(id)) {
        openTools.set(id, name)
        controller.enqueue({ type: 'tool_call_start', id, name })
      }
      continue
    }

    if (event.type === 'response.completed') {
      terminalResponse = event.response
    }
  }

  if (!terminalResponse) {
    throw new Error('OpenAI Responses stream ended without a terminal response')
  }

  const toolCalls = extractResponseToolCalls(terminalResponse.output)
  const text = streamedText || extractResponseText(terminalResponse.output)

  return { response: terminalResponse, text, toolCalls }
}

/**
 * Finalizes one tool execution and emits its terminal lifecycle event.
 */
function completeToolExecution(
  controller: ReadableStreamDefaultController<AgentStreamEvent>,
  openTools: Map<string, string>,
  toolCall: ResponsesToolCall,
  toolParams: Record<string, unknown>,
  result: OpenAIToolExecutionResult['result'],
  startTime: number,
  status: ToolCallEndStatus
): OpenAIToolExecutionResult {
  const endTime = Date.now()
  openTools.delete(toolCall.id)
  controller.enqueue({
    type: 'tool_call_end',
    id: toolCall.id,
    name: toolCall.name,
    status,
  })
  return {
    toolCall,
    toolName: toolCall.name,
    toolParams,
    result,
    startTime,
    endTime,
    duration: endTime - startTime,
  }
}

/**
 * Executes one assembled OpenAI function call.
 */
async function executeOpenAIToolCall(options: {
  toolCall: ResponsesToolCall
  request: ProviderRequest
  controller: ReadableStreamDefaultController<AgentStreamEvent>
  openTools: Map<string, string>
  logger: Logger
}): Promise<OpenAIToolExecutionResult> {
  const { toolCall, request, controller, openTools, logger } = options
  const startTime = Date.now()
  let toolArgs: Record<string, unknown>

  try {
    toolArgs = parseToolArguments(toolCall.arguments, toolCall.name)
  } catch (error) {
    return completeToolExecution(
      controller,
      openTools,
      toolCall,
      {},
      {
        success: false,
        error: getErrorMessage(error, `Invalid tool arguments for ${toolCall.name}`),
      },
      startTime,
      'error'
    )
  }

  const tool = request.tools?.find((candidate) => candidate.id === toolCall.name)
  if (!tool) {
    return completeToolExecution(
      controller,
      openTools,
      toolCall,
      {},
      {
        success: false,
        error: `Tool not found: ${toolCall.name}`,
      },
      startTime,
      'error'
    )
  }

  try {
    if (request.abortSignal?.aborted) {
      throw new DOMException('Stream aborted', 'AbortError')
    }

    const { toolParams, executionParams } = prepareToolExecution(tool, toolArgs, request)
    const result = await executeTool(toolCall.name, executionParams, {
      signal: request.abortSignal,
    })
    return completeToolExecution(
      controller,
      openTools,
      toolCall,
      toolParams,
      result,
      startTime,
      result.success ? 'success' : 'error'
    )
  } catch (error) {
    if (request.abortSignal?.aborted) {
      completeToolExecution(
        controller,
        openTools,
        toolCall,
        {},
        {
          success: false,
          error: getErrorMessage(error, 'Tool execution cancelled'),
        },
        startTime,
        'cancelled'
      )
      throw error
    }
    if (isAbortError(error)) {
      completeToolExecution(
        controller,
        openTools,
        toolCall,
        {},
        {
          success: false,
          error: getErrorMessage(error, 'Tool execution aborted unexpectedly'),
        },
        startTime,
        'error'
      )
      throw error
    }

    logger.error('Error processing OpenAI tool call:', {
      error,
      toolName: toolCall.name,
    })
    return completeToolExecution(
      controller,
      openTools,
      toolCall,
      {},
      {
        success: false,
        error: getErrorMessage(error, 'Tool execution failed'),
      },
      startTime,
      'error'
    )
  }
}

/**
 * Multi-turn OpenAI Responses tool loop as an `agent-events-v1` object stream.
 */
export function createOpenAIResponsesStreamingToolLoopStream(
  options: CreateOpenAIResponsesStreamingToolLoopOptions
): ReadableStream<AgentStreamEvent> {
  const {
    providerId,
    providerLabel,
    request,
    initialInput,
    initialToolChoice,
    createStream,
    logger,
    timeSegments,
    onComplete,
  } = options
  const forcedTools = options.forcedTools ?? []
  const loopAbortController = new AbortController()
  const abortFromRequest = () => loopAbortController.abort(request.abortSignal?.reason)

  if (request.abortSignal?.aborted) {
    abortFromRequest()
  } else {
    request.abortSignal?.addEventListener('abort', abortFromRequest, { once: true })
  }

  const loopRequest: ProviderRequest = {
    ...request,
    abortSignal: loopAbortController.signal,
  }

  return new ReadableStream<AgentStreamEvent>({
    start(controller) {
      void (async () => {
        const currentInput = [...initialInput]
        const usedForcedTools = new Set<string>()
        const tokens = { input: 0, output: 0, total: 0 }
        const toolCalls: unknown[] = []
        const toolResults: Record<string, unknown>[] = []
        const openTools = new Map<string, string>()
        let currentToolChoice = initialToolChoice
        let content = ''
        let iterationCount = 0
        let modelCalls = 0
        let modelTime = 0
        let toolsTime = 0
        let firstResponseTime = 0
        const reportProgress = () => {
          const modelCost = calculateCost(request.model, tokens.input, tokens.output)
          const toolCost = sumToolCosts(toolResults)
          onComplete({
            content,
            tokens,
            cost: {
              input: modelCost.input,
              output: modelCost.output,
              total: modelCost.total + (toolCost || 0),
              ...(toolCost ? { toolCost } : {}),
            },
            toolCalls:
              toolCalls.length > 0 ? { list: toolCalls, count: toolCalls.length } : undefined,
            modelTime,
            toolsTime,
            firstResponseTime,
            iterations: modelCalls,
          })
        }

        try {
          while (modelCalls <= MAX_TOOL_ITERATIONS) {
            if (loopAbortController.signal.aborted) {
              settleOpenTools(controller, openTools, 'cancelled')
              throw new DOMException('Stream aborted', 'AbortError')
            }

            const modelStart = Date.now()
            const finalSynthesis = iterationCount >= MAX_TOOL_ITERATIONS
            const streamResponse = await createStream(
              currentInput,
              {
                stream: true,
                ...(finalSynthesis
                  ? { tools: undefined, tool_choice: 'none' }
                  : currentToolChoice !== undefined
                    ? { tool_choice: currentToolChoice }
                    : {}),
              },
              loopAbortController.signal
            )
            const turn = await streamResponsesTurn(
              streamResponse,
              controller,
              openTools,
              loopAbortController.signal
            )
            const modelEnd = Date.now()
            const modelDuration = modelEnd - modelStart
            const usage = parseResponsesUsage(turn.response.usage)
            const reachedToolLimit = iterationCount >= MAX_TOOL_ITERATIONS
            const toolsExecutable = turn.response.status === 'completed' && !reachedToolLimit
            const executableTools = toolsExecutable ? turn.toolCalls : []

            if (turn.toolCalls.length > 0 && !toolsExecutable) {
              logger.warn('Skipping OpenAI tool execution', {
                status: turn.response.status,
                toolCount: turn.toolCalls.length,
                reachedToolLimit,
              })
              settleOpenTools(controller, openTools, 'error')
            }

            const executableToolIds = new Set(executableTools.map((toolCall) => toolCall.id))
            for (const [id, name] of openTools) {
              if (!executableToolIds.has(id)) {
                openTools.delete(id)
                controller.enqueue({ type: 'tool_call_end', id, name, status: 'error' })
              }
            }

            for (const toolCall of executableTools) {
              if (!openTools.has(toolCall.id)) {
                openTools.set(toolCall.id, toolCall.name)
                controller.enqueue({
                  type: 'tool_call_start',
                  id: toolCall.id,
                  name: toolCall.name,
                })
              }
            }

            const turnKind = executableTools.length > 0 ? 'intermediate' : 'final'
            content = turn.text
            controller.enqueue({ type: 'turn_end', turn: turnKind })

            modelTime += modelDuration
            modelCalls++
            if (modelCalls === 1) {
              firstResponseTime = modelDuration
            }
            timeSegments.push({
              type: 'model',
              name: request.model,
              startTime: modelStart,
              endTime: modelEnd,
              duration: modelDuration,
            })
            enrichLastModelSegmentFromOpenAIResponse(
              timeSegments,
              turn.response,
              turn.text,
              turn.toolCalls,
              { model: request.model }
            )

            if (usage) {
              tokens.input += usage.promptTokens
              tokens.output += usage.completionTokens
              tokens.total += usage.totalTokens
            }

            if (executableTools.length === 0) {
              break
            }

            currentInput.push(...turn.response.output)

            if (typeof currentToolChoice === 'object') {
              for (const toolCall of executableTools) {
                if (forcedTools.includes(toolCall.name)) {
                  usedForcedTools.add(toolCall.name)
                }
              }
            }

            const toolsStart = Date.now()
            const orderedResults = await Promise.all(
              executableTools.map((toolCall) =>
                executeOpenAIToolCall({
                  toolCall,
                  request: loopRequest,
                  controller,
                  openTools,
                  logger,
                })
              )
            )

            for (const result of orderedResults) {
              timeSegments.push({
                type: 'tool',
                name: result.toolName,
                startTime: result.startTime,
                endTime: result.endTime,
                duration: result.duration,
                toolCallId: result.toolCall.id,
              })

              const resultContent = result.result.success
                ? (result.result.output ?? null)
                : {
                    error: true,
                    message: result.result.error || 'Tool execution failed',
                    tool: result.toolName,
                  }

              if (result.result.success && isRecordLike(result.result.output)) {
                toolResults.push(result.result.output)
              }

              toolCalls.push({
                name: result.toolName,
                arguments: result.toolParams,
                startTime: new Date(result.startTime).toISOString(),
                endTime: new Date(result.endTime).toISOString(),
                duration: result.duration,
                result: resultContent,
                success: result.result.success,
              })

              currentInput.push({
                type: 'function_call_output',
                call_id: result.toolCall.id,
                output: JSON.stringify(resultContent),
              })
            }

            toolsTime += Date.now() - toolsStart

            if (typeof currentToolChoice === 'object') {
              const remaining = forcedTools.filter((toolName) => !usedForcedTools.has(toolName))
              currentToolChoice =
                remaining.length > 0 ? { type: 'function', name: remaining[0] } : 'auto'
              if (remaining.length === 0) {
                logger.info('All forced tools have been used, switching to auto tool_choice')
              } else {
                logger.info(`Forcing next tool: ${remaining[0]}`)
              }
            }

            iterationCount++
          }

          reportProgress()
          controller.close()
        } catch (error) {
          reportProgress()
          if (loopAbortController.signal.aborted) {
            if (controller.desiredSize !== null) {
              controller.close()
            }
            return
          }

          settleOpenTools(controller, openTools, 'error')
          logger.error(`Error in ${providerLabel} streaming tool loop`, {
            providerId,
            error,
          })
          controller.error(toError(error))
        } finally {
          request.abortSignal?.removeEventListener('abort', abortFromRequest)
        }
      })()
    },
    cancel(reason) {
      loopAbortController.abort(reason)
      request.abortSignal?.removeEventListener('abort', abortFromRequest)
    },
  })
}
