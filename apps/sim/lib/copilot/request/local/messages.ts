import { loadCopilotChatMessages } from '@/lib/copilot/chat/lifecycle'
import type { Message } from '@/providers/types'

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Load the durable Sim transcript and ensure the current user turn is present. */
export async function buildLocalWorkspaceMessages(
  requestPayload: Record<string, unknown>,
  chatId?: string
): Promise<Message[]> {
  const persistedMessages = chatId ? await loadCopilotChatMessages(chatId) : []
  const messages: Message[] = persistedMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content }))

  const currentMessage = nonBlankString(requestPayload.message)
  const lastMessage = messages.at(-1)
  if (currentMessage && !(lastMessage?.role === 'user' && lastMessage.content === currentMessage)) {
    messages.push({ role: 'user', content: currentMessage })
  }

  return messages
}
