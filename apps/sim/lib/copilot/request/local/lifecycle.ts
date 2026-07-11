import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { handleTextEvent } from '@/lib/copilot/request/handlers/text'
import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import type {
  ExecutionContext,
  StreamEvent,
  StreamingContext,
  ToolCallState,
} from '@/lib/copilot/request/types'
import { ensureHandlersRegistered, executeTool } from '@/lib/copilot/tool-executor'
import { env } from '@/lib/core/config/env'
import type { StreamingExecution } from '@/executor/types'
import { executeProviderRequest } from '@/providers'
import type { ProviderResponse } from '@/providers/types'
import { buildLocalWorkspaceMessages } from './messages'
import { buildLocalWorkspaceSystemPrompt } from './prompt'
import { buildLocalWorkspaceTools } from './tools'

const logger = createLogger('LocalMothershipLifecycle')

function isStreamingExecution(value: unknown): value is StreamingExecution {
  return Boolean(value && typeof value === 'object' && 'stream' in value && 'execution' in value)
}

function isProviderResponse(value: unknown): value is ProviderResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'content' in value &&
      typeof (value as { content?: unknown }).content === 'string'
  )
}

async function emitEvent(
  event: StreamEvent,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions
): Promise<void> {
  if (event.type === MothershipStreamV1EventType.text) {
    await handleTextEvent('main')(event, context, execContext, options)
  }
  await options.onEvent?.(event)
}

async function emitText(
  text: string,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions
): Promise<void> {
  if (!text) return
  await emitEvent(
    {
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text },
    },
    context,
    execContext,
    options
  )
}

function applyProviderMetrics(
  value: StreamingExecution | ProviderResponse,
  context: StreamingContext
) {
  const output = isStreamingExecution(value) ? value.execution.output : value
  const tokens = output.tokens
  if (tokens) {
    context.usage = {
      prompt: tokens.input ?? 0,
      completion: tokens.output ?? 0,
    }
  }
  if (output.cost) {
    context.cost = {
      input: output.cost.input ?? 0,
      output: output.cost.output ?? 0,
      total: output.cost.total ?? 0,
    }
  }
}

async function drainProviderStream(
  response: StreamingExecution,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions
): Promise<void> {
  const reader = response.stream.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk =
      typeof value === 'string'
        ? value
        : value instanceof Uint8Array
          ? decoder.decode(value, { stream: true })
          : String(value ?? '')
    fullContent += chunk
    await emitText(chunk, context, execContext, options)
  }

  const trailing = decoder.decode()
  if (trailing) {
    fullContent += trailing
    await emitText(trailing, context, execContext, options)
  }

  await response.onFullContent?.(fullContent)
  applyProviderMetrics(response, context)
}

function addToolCallBlock(context: StreamingContext, toolCall: ToolCallState): void {
  context.toolCalls.set(toolCall.id, toolCall)
  context.contentBlocks.push({
    type: 'tool_call',
    toolCall,
    timestamp: toolCall.startTime ?? Date.now(),
  })
}

function finishToolCallBlock(context: StreamingContext, toolCallId: string, endedAt: number): void {
  for (let index = context.contentBlocks.length - 1; index >= 0; index--) {
    const block = context.contentBlocks[index]
    if (block.type === 'tool_call' && block.toolCall?.id === toolCallId) {
      block.endedAt = endedAt
      return
    }
  }
}

/** Run a workspace chat turn locally through Sim's provider and tool runtimes. */
export async function runLocalMothershipLifecycle(
  requestPayload: Record<string, unknown>,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: CopilotLifecycleOptions
): Promise<void> {
  const model = env.MOTHERSHIP_MODEL
  if (!model) throw new Error('MOTHERSHIP_MODEL is required for local Mothership execution')
  if (!model.startsWith('litellm/')) {
    throw new Error('Local Mothership currently supports only litellm/* models')
  }

  ensureHandlersRegistered()
  const [messages, tools] = await Promise.all([
    buildLocalWorkspaceMessages(requestPayload, options.chatId),
    Promise.resolve(buildLocalWorkspaceTools(requestPayload)),
  ])

  logger.info('Starting local workspace agent turn', {
    model,
    workspaceId: options.workspaceId,
    chatId: options.chatId,
    messageCount: messages.length,
    toolCount: tools.length,
  })

  const response = await executeProviderRequest('litellm', {
    model,
    systemPrompt: buildLocalWorkspaceSystemPrompt(requestPayload),
    messages,
    tools,
    workspaceId: options.workspaceId,
    chatId: options.chatId,
    userId: options.userId,
    stream: true,
    abortSignal: options.abortSignal,
    toolExecutor: async ({ toolCallId, toolId, params }) => {
      const startTime = Date.now()
      const toolCall: ToolCallState = {
        id: toolCallId,
        name: toolId,
        status: 'executing',
        params,
        startTime,
      }
      addToolCallBlock(context, toolCall)

      await options.onEvent?.({
        type: MothershipStreamV1EventType.tool,
        payload: {
          phase: MothershipStreamV1ToolPhase.call,
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.sync,
          status: 'executing',
          toolCallId,
          toolName: toolId,
          arguments: params,
        },
      })

      let result
      try {
        result = await executeTool(toolId, params, {
          ...execContext,
          abortSignal: options.abortSignal,
          copilotToolExecution: true,
        })
      } catch (error) {
        result = { success: false, error: toError(error).message }
      }

      const endTime = Date.now()
      toolCall.status = result.success
        ? MothershipStreamV1ToolOutcome.success
        : MothershipStreamV1ToolOutcome.error
      toolCall.result = {
        success: result.success,
        ...(result.output !== undefined ? { output: result.output } : {}),
      }
      if (result.error) toolCall.error = result.error
      toolCall.endTime = endTime
      finishToolCallBlock(context, toolCallId, endTime)

      await options.onEvent?.({
        type: MothershipStreamV1EventType.tool,
        payload: {
          phase: MothershipStreamV1ToolPhase.result,
          executor: MothershipStreamV1ToolExecutor.sim,
          mode: MothershipStreamV1ToolMode.sync,
          status: toolCall.status,
          success: result.success,
          toolCallId,
          toolName: toolId,
          ...(result.output !== undefined ? { output: result.output } : {}),
          ...(result.error ? { error: result.error } : {}),
        },
      })

      return result
    },
  })

  if (isStreamingExecution(response)) {
    await drainProviderStream(response, context, execContext, options)
    return
  }
  if (isProviderResponse(response)) {
    await emitText(response.content, context, execContext, options)
    applyProviderMetrics(response, context)
    return
  }

  throw new Error('LiteLLM returned an unsupported response type')
}
