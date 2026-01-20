import { createLogger } from '@sim/logger'
import type { CopilotMode, CopilotModelId, CopilotTransportMode } from '@/lib/copilot/models'

const logger = createLogger('CopilotAPI')

/**
 * Response from chat initiation endpoint
 */
export interface ChatInitResponse {
  success: boolean
  streamId: string
  chatId: string
}

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
 * Chat config stored in database
 */
export interface CopilotChatConfig {
  mode?: CopilotMode
  model?: CopilotModelId
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
  planArtifact: string | null
  config: CopilotChatConfig | null
  createdAt: Date
  updatedAt: Date
}

/**
 * File attachment interface for message requests
 */
export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

/**
 * Request interface for sending messages
 */
export interface SendMessageRequest {
  message: string
  userMessageId?: string // ID from frontend for the user message
  chatId?: string
  workflowId?: string
  mode?: CopilotMode | CopilotTransportMode
  model?: CopilotModelId
  prefetch?: boolean
  createNewChat?: boolean
  stream?: boolean
  implicitFeedback?: string
  fileAttachments?: MessageFileAttachment[]
  abortSignal?: AbortSignal
  contexts?: Array<{
    kind: string
    label?: string
    chatId?: string
    workflowId?: string
    executionId?: string
  }>
  commands?: string[]
}

/**
 * Base API response interface
 */
export interface ApiResponse {
  success: boolean
  error?: string
  status?: number
}

/**
 * Streaming response interface
 */
export interface StreamingResponse extends ApiResponse {
  stream?: ReadableStream
}

/**
 * Handle API errors and return user-friendly error messages
 */
async function handleApiError(response: Response, defaultMessage: string): Promise<string> {
  try {
    const data = await response.json()
    return (data && (data.error || data.message)) || defaultMessage
  } catch {
    return `${defaultMessage} (${response.status})`
  }
}

/**
 * Send a streaming message to the copilot chat API
 * This is the main API endpoint that handles all chat operations
 *
 * Server-first architecture:
 * 1. POST to /api/copilot/chat - starts background processing, returns { streamId, chatId }
 * 2. Connect to /api/copilot/stream/{streamId} for SSE stream
 *
 * This ensures stream continues server-side even if client disconnects
 */
export async function sendStreamingMessage(
  request: SendMessageRequest
): Promise<StreamingResponse & { streamId?: string; chatId?: string }> {
  try {
    const { abortSignal, ...requestBody } = request
    try {
      const preview = Array.isArray((requestBody as any).contexts)
        ? (requestBody as any).contexts.map((c: any) => ({
            kind: c?.kind,
            chatId: c?.chatId,
            workflowId: c?.workflowId,
            label: c?.label,
          }))
        : undefined
      logger.info('Preparing to send streaming message', {
        hasContexts: Array.isArray((requestBody as any).contexts),
        contextsCount: Array.isArray((requestBody as any).contexts)
          ? (requestBody as any).contexts.length
          : 0,
        contextsPreview: preview,
      })
    } catch {}

    // Step 1: Initiate chat - server starts background processing
    const initResponse = await fetch('/api/copilot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, stream: true }),
      credentials: 'include',
    })

    if (!initResponse.ok) {
      const errorMessage = await handleApiError(initResponse, 'Failed to initiate chat')
      return {
        success: false,
        error: errorMessage,
        status: initResponse.status,
      }
    }

    const initData: ChatInitResponse = await initResponse.json()
    if (!initData.success || !initData.streamId) {
      return {
        success: false,
        error: 'Failed to get stream ID from server',
        status: 500,
      }
    }

    logger.info('Chat initiated, connecting to stream', {
      streamId: initData.streamId,
      chatId: initData.chatId,
    })

    // Step 2: Connect to stream endpoint for SSE
    const streamResponse = await fetch(`/api/copilot/stream/${initData.streamId}`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: abortSignal,
      credentials: 'include',
    })

    if (!streamResponse.ok) {
      // Handle completed/not found cases
      if (streamResponse.status === 404) {
        return {
          success: false,
          error: 'Stream not found or expired',
          status: 404,
          streamId: initData.streamId,
          chatId: initData.chatId,
        }
      }

      const errorMessage = await handleApiError(streamResponse, 'Failed to connect to stream')
      return {
        success: false,
        error: errorMessage,
        status: streamResponse.status,
        streamId: initData.streamId,
        chatId: initData.chatId,
      }
    }

    if (!streamResponse.body) {
      return {
        success: false,
        error: 'No stream body received',
        status: 500,
        streamId: initData.streamId,
        chatId: initData.chatId,
      }
    }

    return {
      success: true,
      stream: streamResponse.body,
      streamId: initData.streamId,
      chatId: initData.chatId,
    }
  } catch (error) {
    // Handle AbortError gracefully - this is expected when user aborts
    if (error instanceof Error && error.name === 'AbortError') {
      logger.info('Streaming message was aborted by user')
      return {
        success: false,
        error: 'Request was aborted',
      }
    }

    logger.error('Failed to send streaming message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
