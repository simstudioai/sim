import type Anthropic from '@anthropic-ai/sdk'
import { buildAnthropicMessageContent } from '@/providers/attachments'
import { parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import type { Message } from '@/providers/types'

interface ConvertAnthropicRequestHistoryOptions {
  messages?: Message[]
  systemPrompt?: string
  context?: string
  providerId: string
}

interface ConvertedAnthropicRequestHistory {
  messages: Anthropic.Messages.MessageParam[]
  systemPrompt: string
}

interface PendingToolCall {
  id: string
  name: string
}

/**
 * Converts Sim's shared request history into Anthropic's message protocol.
 */
export function convertAnthropicRequestHistory({
  messages: sourceMessages = [],
  systemPrompt,
  context,
  providerId,
}: ConvertAnthropicRequestHistoryOptions): ConvertedAnthropicRequestHistory {
  const convertedMessages: Anthropic.Messages.MessageParam[] = []
  const systemParts = systemPrompt ? [systemPrompt] : []
  const pendingToolCalls = new Map<string, PendingToolCall>()
  let toolResultBlocks: Anthropic.Messages.ContentBlockParam[] | undefined

  if (context) {
    convertedMessages.push({
      role: 'user',
      content: [{ type: 'text', text: context }],
    })
  }

  const assertNoPendingToolCalls = () => {
    if (pendingToolCalls.size > 0) {
      throw new Error(
        `Anthropic request history is missing tool results for: ${[...pendingToolCalls.values()]
          .map(({ name, id }) => `${name} (${id})`)
          .join(', ')}`
      )
    }
    toolResultBlocks = undefined
  }

  const registerToolCall = (toolCall: PendingToolCall) => {
    if (!toolCall.id) {
      throw new Error(`Anthropic tool call "${toolCall.name}" is missing an ID`)
    }
    if (pendingToolCalls.has(toolCall.id)) {
      throw new Error(`Anthropic request history contains duplicate tool call ID "${toolCall.id}"`)
    }
    pendingToolCalls.set(toolCall.id, toolCall)
  }

  const appendToolResult = (toolCallId: string | undefined, content: string | null) => {
    if (!toolCallId || !pendingToolCalls.has(toolCallId)) {
      throw new Error(
        `Anthropic request history contains a tool result without a matching tool call${
          toolCallId ? `: ${toolCallId}` : ''
        }`
      )
    }

    const resultBlock: Anthropic.Messages.ToolResultBlockParam = {
      type: 'tool_result',
      tool_use_id: toolCallId,
      ...(content !== null ? { content } : {}),
    }

    if (!toolResultBlocks) {
      toolResultBlocks = [resultBlock]
      convertedMessages.push({ role: 'user', content: toolResultBlocks })
    } else {
      toolResultBlocks.push(resultBlock)
    }

    pendingToolCalls.delete(toolCallId)
  }

  sourceMessages.forEach((message, messageIndex) => {
    if (message.role === 'system') {
      if (message.content) {
        systemParts.push(message.content)
      }
      return
    }

    if (message.role === 'tool') {
      appendToolResult(message.tool_call_id, message.content)
      return
    }

    if (message.role === 'function') {
      const matchingCall = [...pendingToolCalls.values()].find(
        (toolCall) => toolCall.name === message.name
      )
      appendToolResult(matchingCall?.id, message.content)
      return
    }

    assertNoPendingToolCalls()

    const content = buildAnthropicMessageContent(message.content, message.files, providerId)
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const toolUseBlocks = message.tool_calls.map((toolCall) => {
        const block: Anthropic.Messages.ToolUseBlockParam = {
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments, toolCall.function.name),
        }
        registerToolCall({ id: block.id, name: block.name })
        return block
      })
      convertedMessages.push({
        role: 'assistant',
        content: [...content, ...toolUseBlocks],
      })
      return
    }

    if (message.role === 'assistant' && message.function_call) {
      const toolUseId = `legacy-function-call-${messageIndex}`
      const toolUseBlock: Anthropic.Messages.ToolUseBlockParam = {
        type: 'tool_use',
        id: toolUseId,
        name: message.function_call.name,
        input: parseToolArguments(message.function_call.arguments, message.function_call.name),
      }
      registerToolCall({ id: toolUseId, name: toolUseBlock.name })
      convertedMessages.push({
        role: 'assistant',
        content: [...content, toolUseBlock],
      })
      return
    }

    if (content.length > 0) {
      convertedMessages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content,
      })
    }
  })

  assertNoPendingToolCalls()

  return {
    messages: convertedMessages,
    systemPrompt: systemParts.join('\n\n'),
  }
}
