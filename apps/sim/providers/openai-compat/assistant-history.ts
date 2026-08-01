export type OpenAICompatReasoningField = 'reasoning' | 'reasoning_content'

interface OpenAICompatResponseAssistantMessage {
  content: string | null
}

interface OpenAICompatResponseAssistantReasoning {
  reasoning?: string
  reasoning_content?: string
}

interface OpenAICompatToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

export interface OpenAICompatAssistantHistoryMessage {
  [key: string]: unknown
  role: 'assistant'
  content: string | null
  tool_calls: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  reasoning?: string
  reasoning_content?: string
}

interface CreateOpenAICompatAssistantHistoryOptions {
  message: OpenAICompatResponseAssistantMessage
  toolCalls: readonly OpenAICompatToolCall[]
  reasoningFields: readonly OpenAICompatReasoningField[]
}

/**
 * Replays an OpenAI-compatible assistant tool turn without replacing provider
 * content or inventing reasoning fields the provider did not emit.
 */
export function createOpenAICompatAssistantHistory({
  message,
  toolCalls,
  reasoningFields,
}: CreateOpenAICompatAssistantHistoryOptions): OpenAICompatAssistantHistoryMessage {
  const reasoningMessage = message as OpenAICompatResponseAssistantMessage &
    OpenAICompatResponseAssistantReasoning
  const history: OpenAICompatAssistantHistoryMessage = {
    role: 'assistant',
    content: message.content,
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    })),
  }

  for (const field of reasoningFields) {
    const value = reasoningMessage[field]
    if (typeof value === 'string') {
      history[field] = value
    }
  }

  return history
}
