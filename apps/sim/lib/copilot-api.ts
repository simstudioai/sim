import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('CopilotAPI')

/**
 * Message interface for copilot conversations
 */
export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: Array<{
    id: number
    title: string
    url: string
    similarity?: number
  }>
}

/**
 * Chat interface for copilot conversations
 */
export interface CopilotChat {
  id: string
  title: string | null
  model: string
  messages: CopilotMessage[]
  messageCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Request interface for sending messages
 */
export interface SendMessageRequest {
  message: string
  chatId?: string
  workflowId?: string
  createNewChat?: boolean
  stream?: boolean
}

/**
 * Request interface for docs queries
 */
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
 * Create a new copilot chat
 */
export async function createChat(
  workflowId: string,
  options: {
    title?: string
    initialMessage?: string
  } = {}
): Promise<{
  success: boolean
  chat?: CopilotChat
  error?: string
}> {
  try {
    const response = await fetch('/api/copilot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        ...options,
      }),
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
 * List chats for a specific workflow
 */
export async function listChats(
  workflowId: string,
  options: {
    limit?: number
    offset?: number
  } = {}
): Promise<{
  success: boolean
  chats: CopilotChat[]
  error?: string
}> {
  try {
    const params = new URLSearchParams({
      workflowId,
      limit: (options.limit || 50).toString(),
      offset: (options.offset || 0).toString(),
    })

    const response = await fetch(`/api/copilot?${params}`)
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
 * Get a specific chat with full message history
 */
export async function getChat(chatId: string): Promise<{
  success: boolean
  chat?: CopilotChat
  error?: string
}> {
  try {
    const response = await fetch(`/api/copilot?chatId=${chatId}`)
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
 * Delete a chat
 */
export async function deleteChat(chatId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const response = await fetch(`/api/copilot?chatId=${chatId}`, {
      method: 'DELETE',
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete chat')
    }

    return { success: true }
  } catch (error) {
    logger.error('Failed to delete chat:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send a message using the unified copilot API
 */
export async function sendMessage(request: SendMessageRequest): Promise<{
  success: boolean
  response?: string
  chatId?: string
  citations?: Array<{
    id: number
    title: string
    url: string
    similarity?: number
  }>
  error?: string
}> {
  try {
    const response = await fetch('/api/copilot', {
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
      citations: data.citations,
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
 * Send a streaming message using the unified copilot API
 */
export async function sendStreamingMessage(request: SendMessageRequest): Promise<{
  success: boolean
  stream?: ReadableStream
  chatId?: string
  error?: string
}> {
  try {
    console.log('[CopilotAPI] Sending streaming message request:', { 
      message: request.message, 
      stream: true,
      hasWorkflowId: !!request.workflowId
    })

    const response = await fetch('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    })

    console.log('[CopilotAPI] Fetch response received:', {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      hasBody: !!response.body,
      contentType: response.headers.get('content-type')
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('[CopilotAPI] Error response:', errorData)
      throw new Error(errorData.error || 'Failed to send streaming message')
    }

    if (!response.body) {
      console.error('[CopilotAPI] No response body received')
      throw new Error('No response body received')
    }

    console.log('[CopilotAPI] Successfully received stream')
    return {
      success: true,
      stream: response.body,
    }
  } catch (error) {
    console.error('[CopilotAPI] Failed to send streaming message:', error)
    logger.error('Failed to send streaming message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send a message using the docs RAG API with chat context
 */
export async function sendDocsMessage(request: DocsQueryRequest): Promise<{
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
    const response = await fetch('/api/copilot/docs', {
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
    logger.error('Failed to send docs message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send a streaming docs message
 */
export async function sendStreamingDocsMessage(request: DocsQueryRequest): Promise<{
  success: boolean
  stream?: ReadableStream
  chatId?: string
  error?: string
}> {
  try {
    console.log('[CopilotAPI] sendStreamingDocsMessage called with:', request)
    
    const response = await fetch('/api/copilot/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    })

    console.log('[CopilotAPI] Fetch response received:', { 
      status: response.status, 
      statusText: response.statusText, 
      headers: Object.fromEntries(response.headers.entries()),
      ok: response.ok,
      hasBody: !!response.body
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('[CopilotAPI] API error response:', errorData)
      throw new Error(errorData.error || 'Failed to send streaming docs message')
    }

    if (!response.body) {
      console.error('[CopilotAPI] No response body received')
      throw new Error('No response body received')
    }

    console.log('[CopilotAPI] Returning successful result with stream')
    return {
      success: true,
      stream: response.body,
    }
  } catch (error) {
    console.error('[CopilotAPI] Error in sendStreamingDocsMessage:', error)
    logger.error('Failed to send streaming docs message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
