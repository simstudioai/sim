import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('CopilotAPI')

export interface CopilotChat {
  id: string
  title: string | null
  model: string
  createdAt: string
  updatedAt: string
  messageCount: number
  messages?: CopilotMessage[]
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  citations?: Array<{
    id: number
    title: string
    url: string
  }>
}

export interface CreateChatRequest {
  workflowId: string
  title?: string
  model?: string
  initialMessage?: string
}

export interface UpdateChatRequest {
  title?: string
  messages?: CopilotMessage[]
  model?: string
}

export interface DocsQueryRequest {
  query: string
  topK?: number
  provider?: string
  model?: string
  stream?: boolean
  chatId?: string
  workflowId?: string
  createNewChat?: boolean
}

/**
 * List chats for a specific workflow
 */
export async function listChats(
  workflowId: string,
  limit = 50,
  offset = 0
): Promise<{
  success: boolean
  chats: CopilotChat[]
  error?: string
}> {
  try {
    const params = new URLSearchParams({
      workflowId,
      limit: limit.toString(),
      offset: offset.toString(),
    })

    const response = await fetch(`/api/copilot/chats?${params}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list chats')
    }

    return {
      success: true,
      chats: data.chats || [],
    }
  } catch (error) {
    logger.error('Failed to list chats:', error)
    return {
      success: false,
      chats: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create a new chat
 */
export async function createChat(request: CreateChatRequest): Promise<{
  success: boolean
  chat?: CopilotChat
  error?: string
}> {
  try {
    const response = await fetch('/api/copilot/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create chat')
    }

    return {
      success: true,
      chat: data.chat,
    }
  } catch (error) {
    logger.error('Failed to create chat:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get a specific chat with full message history
 */
export async function getChat(chatId: string): Promise<{
  success: boolean
  chat?: CopilotChat
  error?: string
}> {
  try {
    const response = await fetch(`/api/copilot/chats/${chatId}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get chat')
    }

    return {
      success: true,
      chat: data.chat,
    }
  } catch (error) {
    logger.error('Failed to get chat:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Update a chat
 */
export async function updateChat(
  chatId: string,
  request: UpdateChatRequest
): Promise<{
  success: boolean
  chat?: CopilotChat
  error?: string
}> {
  try {
    const response = await fetch(`/api/copilot/chats/${chatId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update chat')
    }

    return {
      success: true,
      chat: data.chat,
    }
  } catch (error) {
    logger.error('Failed to update chat:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Delete a chat
 */
export async function deleteChat(chatId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const response = await fetch(`/api/copilot/chats/${chatId}`, {
      method: 'DELETE',
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete chat')
    }

    return {
      success: true,
    }
  } catch (error) {
    logger.error('Failed to delete chat:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send a message using the docs RAG API with chat context
 */
export async function sendMessage(request: DocsQueryRequest): Promise<{
  success: boolean
  response?: string
  chatId?: string
  sources?: Array<{
    title: string
    document: string
    link: string
    similarity: number
  }>
  error?: string
}> {
  try {
    const response = await fetch('/api/docs/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send message')
    }

    return {
      success: true,
      response: data.response,
      chatId: data.chatId,
      sources: data.sources,
    }
  } catch (error) {
    logger.error('Failed to send message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send a streaming message using the new copilot chat API
 */
export async function sendStreamingMessage(request: {
  message: string
  chatId?: string
  workflowId?: string
  createNewChat?: boolean
}): Promise<{
  success: boolean
  stream?: ReadableStream
  chatId?: string
  error?: string
}> {
  try {
    const response = await fetch('/api/copilot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to send streaming message')
    }

    if (!response.body) {
      throw new Error('No response body received')
    }

    return {
      success: true,
      stream: response.body,
    }
  } catch (error) {
    logger.error('Failed to send streaming message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
