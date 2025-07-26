import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotAPI')

/**
 * Citation interface for documentation references
 */
export interface Citation {
  id: number
  title: string
  url: string
  similarity?: number
}

/**
 * Checkpoint interface for copilot workflow checkpoints
 */
export interface CopilotCheckpoint {
  id: string
  userId: string
  workflowId: string
  chatId: string
  yaml: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Message interface for copilot conversations
 */
export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  citations?: Citation[]
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
  mode?: 'ask' | 'agent'
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
 * Options for creating a new chat
 */
export interface CreateChatOptions {
  title?: string
  initialMessage?: string
}

/**
 * Options for listing chats
 */
export interface ListChatsOptions {
  limit?: number
  offset?: number
}

/**
 * Options for listing checkpoints
 */
export interface ListCheckpointsOptions {
  limit?: number
  offset?: number
}

/**
 * API response interface
 */
export interface ApiResponse<T = any> {
  success: boolean
  error?: string
  data?: T
}

/**
 * Chat response interface
 */
export interface ChatResponse extends ApiResponse<CopilotChat> {
  chat?: CopilotChat
}

/**
 * Chats list response interface
 */
export interface ChatsListResponse extends ApiResponse<CopilotChat[]> {
  chats: CopilotChat[]
}

/**
 * Message response interface
 */
export interface MessageResponse extends ApiResponse {
  response?: string
  chatId?: string
  citations?: Citation[]
}

/**
 * Streaming response interface
 */
export interface StreamingResponse extends ApiResponse {
  stream?: ReadableStream
  chatId?: string
}

/**
 * Docs response interface
 */
export interface DocsResponse extends ApiResponse {
  response?: string
  chatId?: string
  sources?: Array<{
    title: string
    document: string
    link: string
    similarity: number
  }>
}

/**
 * Checkpoints response interface
 */
export interface CheckpointsResponse extends ApiResponse<CopilotCheckpoint[]> {
  checkpoints: CopilotCheckpoint[]
}

/**
 * Helper function to handle API errors
 */
async function handleApiError(response: Response, defaultMessage: string): Promise<string> {
  try {
    const errorData = await response.json()
    return errorData.error || defaultMessage
  } catch {
    return response.statusText || defaultMessage
  }
}

/**
 * Helper function to make API requests with consistent error handling
 */
async function makeApiRequest<T>(
  url: string,
  options: RequestInit,
  defaultErrorMessage: string
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, options)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || defaultErrorMessage)
    }

    return {
      success: true,
      data,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`API request failed: ${defaultErrorMessage}`, error)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Create a new copilot chat
 */
export async function createChat(
  workflowId: string,
  options: CreateChatOptions = {}
): Promise<ChatResponse> {
  const result = await makeApiRequest<any>(
    '/api/copilot',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        ...options,
      }),
    },
    'Failed to create chat'
  )

  return {
    success: result.success,
    chat: result.data?.chat,
    error: result.error,
  }
}

/**
 * List chats for a specific workflow
 */
export async function listChats(
  workflowId: string,
  options: ListChatsOptions = {}
): Promise<ChatsListResponse> {
  const params = new URLSearchParams({
    workflowId,
    limit: (options.limit || 50).toString(),
    offset: (options.offset || 0).toString(),
  })

  const result = await makeApiRequest<any>(`/api/copilot?${params}`, {}, 'Failed to list chats')

  return {
    success: result.success,
    chats: result.data?.chats || [],
    error: result.error,
  }
}

/**
 * Get a specific chat with full message history
 */
export async function getChat(chatId: string): Promise<ChatResponse> {
  const result = await makeApiRequest<any>(
    `/api/copilot?chatId=${chatId}`,
    {},
    'Failed to get chat'
  )

  return {
    success: result.success,
    chat: result.data?.chat,
    error: result.error,
  }
}

/**
 * Update a chat with new messages
 */
export async function updateChatMessages(
  chatId: string,
  messages: CopilotMessage[]
): Promise<ChatResponse> {
  const result = await makeApiRequest<any>(
    '/api/copilot',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        messages,
      }),
    },
    'Failed to update chat'
  )

  return {
    success: result.success,
    chat: result.data?.chat,
    error: result.error,
  }
}

/**
 * Delete a chat
 */
export async function deleteChat(chatId: string): Promise<ApiResponse> {
  const result = await makeApiRequest<any>(
    `/api/copilot?chatId=${chatId}`,
    { method: 'DELETE' },
    'Failed to delete chat'
  )

  return {
    success: result.success,
    error: result.error,
  }
}

/**
 * Send a message using the unified copilot API
 */
export async function sendMessage(request: SendMessageRequest): Promise<MessageResponse> {
  const result = await makeApiRequest<any>(
    '/api/copilot',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
    'Failed to send message'
  )

  return {
    success: result.success,
    response: result.data?.response,
    chatId: result.data?.chatId,
    citations: result.data?.citations,
    error: result.error,
  }
}

/**
 * Send a streaming message using the unified copilot API
 */
export async function sendStreamingMessage(
  request: SendMessageRequest
): Promise<StreamingResponse> {
  try {
    const response = await fetch('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    })

    if (!response.ok) {
      const errorMessage = await handleApiError(response, 'Failed to send streaming message')
      throw new Error(errorMessage)
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

/**
 * Send a documentation query using the main copilot API
 */
export async function sendDocsMessage(request: DocsQueryRequest): Promise<DocsResponse> {
  const message = `Please search the documentation and answer this question: ${request.query}`

  const result = await makeApiRequest<any>(
    '/api/copilot',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        chatId: request.chatId,
        workflowId: request.workflowId,
        createNewChat: request.createNewChat,
        stream: request.stream,
      }),
    },
    'Failed to send docs message'
  )

  return {
    success: result.success,
    response: result.data?.response,
    chatId: result.data?.chatId,
    sources: [], // Main agent embeds citations directly in response
    error: result.error,
  }
}

/**
 * Send a streaming documentation query using the main copilot API
 */
export async function sendStreamingDocsMessage(
  request: DocsQueryRequest
): Promise<StreamingResponse> {
  try {
    const message = `Please search the documentation and answer this question: ${request.query}`

    const response = await fetch('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        chatId: request.chatId,
        workflowId: request.workflowId,
        createNewChat: request.createNewChat,
        stream: true,
      }),
    })

    if (!response.ok) {
      const errorMessage = await handleApiError(response, 'Failed to send streaming docs message')
      throw new Error(errorMessage)
    }

    if (!response.body) {
      throw new Error('No response body received')
    }

    return {
      success: true,
      stream: response.body,
    }
  } catch (error) {
    logger.error('Failed to send streaming docs message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * List checkpoints for a specific chat
 */
export async function listCheckpoints(
  chatId: string,
  options: ListCheckpointsOptions = {}
): Promise<CheckpointsResponse> {
  const params = new URLSearchParams({
    chatId,
    limit: (options.limit || 10).toString(),
    offset: (options.offset || 0).toString(),
  })

  const result = await makeApiRequest<any>(
    `/api/copilot/checkpoints?${params}`,
    {},
    'Failed to list checkpoints'
  )

  return {
    success: result.success,
    checkpoints: result.data?.checkpoints || [],
    error: result.error,
  }
}

/**
 * Revert workflow to a specific checkpoint
 */
export async function revertToCheckpoint(checkpointId: string): Promise<ApiResponse> {
  const result = await makeApiRequest<any>(
    `/api/copilot/checkpoints/${checkpointId}/revert`,
    { method: 'POST' },
    'Failed to revert to checkpoint'
  )

  return {
    success: result.success,
    error: result.error,
  }
}
