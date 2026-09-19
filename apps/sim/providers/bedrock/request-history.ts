import type {
  Message as BedrockMessage,
  ContentBlock,
  SystemContentBlock,
  ToolUseBlock,
} from '@aws-sdk/client-bedrock-runtime'
import { isRecordLike } from '@sim/utils/object'
import { renderConversationExecutionRecord } from '@/lib/memory/execution-record'
import { buildBedrockMessageContent } from '@/providers/attachments'
import {
  getNativeConversationMessage,
  getNativeConversationPrefixHash,
  retainConversationMessageSource,
} from '@/providers/conversation-metadata'
import { getConversationPrefixHash } from '@/providers/conversation-prefix'
import { parseToolArguments } from '@/providers/streaming-tool-loop-shared'
import type { ProviderRequest } from '@/providers/types'

/** Converts shared history without splitting parallel tool calls or their results. */
export function convertBedrockRequestHistory(request: ProviderRequest): {
  messages: BedrockMessage[]
  systemContent: SystemContentBlock[]
} {
  const messages: BedrockMessage[] = []
  const systemContent: SystemContentBlock[] = []
  if (request.systemPrompt) systemContent.push({ text: request.systemPrompt })
  if (request.context) messages.push({ role: 'user', content: [{ text: request.context }] })

  const sourceMessages = request.messages ?? []
  let pendingLegacyCall: { id: string; name: string } | undefined
  for (let index = 0; index < sourceMessages.length; index++) {
    const message = sourceMessages[index]
    if (message.role === 'system') {
      if (message.content) systemContent.push({ text: message.content })
      continue
    }

    const nativeMessage = getNativeConversationMessage(message, 'bedrock')
    if (
      isRecordLike(nativeMessage) &&
      Array.isArray(nativeMessage.content) &&
      (nativeMessage.role === 'assistant' || nativeMessage.role === 'user')
    ) {
      const hasReasoning = nativeMessage.content.some(
        (block) => isRecordLike(block) && 'reasoningContent' in block
      )
      const prefixHash = getNativeConversationPrefixHash(message)
      if (hasReasoning && (!prefixHash || prefixHash !== getConversationPrefixHash(messages))) {
        const group = [message]
        while (sourceMessages[index + 1]?.role === 'tool') group.push(sourceMessages[++index])
        messages.push({
          role: 'user',
          content: [{ text: renderConversationExecutionRecord(group).content ?? '' }],
        })
        continue
      }
      messages.push(
        retainConversationMessageSource(message, {
          role: nativeMessage.role,
          content: (nativeMessage.content as ContentBlock[]).filter(
            (block) => !('text' in block) || Boolean(block.text?.trim())
          ),
        })
      )
      continue
    }

    if (message.role === 'function' || message.role === 'tool') {
      let toolUseId = message.tool_call_id
      if (message.role === 'function') {
        if (!pendingLegacyCall || pendingLegacyCall.name !== message.name) {
          throw new Error('Bedrock function result has no matching legacy function call')
        }
        toolUseId = pendingLegacyCall.id
        pendingLegacyCall = undefined
      }
      const previous = messages.at(-1)
      const resultGroup =
        previous?.role === 'user' &&
        previous.content?.length &&
        previous.content.every((item) => 'toolResult' in item)
          ? previous
          : undefined
      const assistant = resultGroup ? messages.at(-2) : previous
      if (
        !toolUseId ||
        assistant?.role !== 'assistant' ||
        !assistant.content?.some((item) => item.toolUse?.toolUseId === toolUseId) ||
        resultGroup?.content?.some((item) => item.toolResult?.toolUseId === toolUseId)
      ) {
        throw new Error('Bedrock tool result has no matching unresolved assistant tool call')
      }
      const block: ContentBlock = {
        toolResult: {
          toolUseId,
          content: [{ text: message.content ?? '' }],
        },
      }
      if (resultGroup?.content) {
        resultGroup.content.push(block)
      } else {
        messages.push({ role: 'user', content: [block] })
      }
      continue
    }

    /** The shared builder emits the Bedrock union while retaining provider-neutral types. */
    const content = buildBedrockMessageContent(
      message.content,
      message.files,
      'bedrock'
    ) as ContentBlock[]
    const calls =
      message.tool_calls ??
      (message.function_call
        ? [
            {
              id: `legacy-function-call-${index}`,
              function: message.function_call,
            },
          ]
        : [])
    if (!message.tool_calls && message.function_call) {
      pendingLegacyCall = { id: calls[0].id, name: message.function_call.name }
    }
    for (const call of calls) {
      content.push({
        toolUse: {
          toolUseId: call.id,
          name: call.function.name,
          input: parseToolArguments(
            call.function.arguments,
            call.function.name
          ) as ToolUseBlock['input'],
        },
      })
    }
    messages.push(
      retainConversationMessageSource(message, {
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content,
      })
    )
  }

  return { messages, systemContent }
}
