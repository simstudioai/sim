import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionContext } from '@/executor/types'
import { buildAPIUrl, buildAuthHeaders } from '@/executor/utils/http'
import { stringifyJSON } from '@/executor/utils/json'
import type { AgentInputs, Message } from './types'

const logger = createLogger('MemoryService')

/**
 * Service for managing agent conversation memory
 * Handles fetching and persisting messages to the memory table
 */
export class MemoryService {
  /**
   * Fetch messages from memory based on memoryType configuration
   */
  async fetchMemoryMessages(ctx: ExecutionContext, inputs: AgentInputs): Promise<Message[]> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return []
    }

    if (!ctx.workflowId) {
      logger.warn('Cannot fetch memory without workflowId')
      return []
    }

    try {
      // Validate inputs before processing
      this.validateInputs(inputs.conversationId)

      const memoryKey = this.buildMemoryKey(ctx, inputs)
      const messages = await this.fetchFromMemoryAPI(ctx.workflowId, memoryKey)

      // Apply sliding window if configured
      if (inputs.slidingWindowSize && inputs.memoryType === 'sliding_window') {
        return this.applySlidingWindow(messages, inputs.slidingWindowSize)
      }

      return messages
    } catch (error) {
      logger.error('Failed to fetch memory messages:', error)
      return []
    }
  }

  /**
   * Persist assistant response to memory
   * Uses atomic append operations to prevent race conditions
   */
  async persistMemoryMessage(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    assistantMessage: Message
  ): Promise<void> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return
    }

    if (!ctx.workflowId) {
      logger.warn('Cannot persist memory without workflowId')
      return
    }

    try {
      // Validate inputs before processing
      this.validateInputs(inputs.conversationId, assistantMessage.content)

      const memoryKey = this.buildMemoryKey(ctx, inputs)

      // For sliding window, we need to fetch and recompute
      // For other memory types, use atomic append
      if (inputs.slidingWindowSize && inputs.memoryType === 'sliding_window') {
        // Fetch existing messages
        const existingMessages = await this.fetchFromMemoryAPI(ctx.workflowId, memoryKey)

        // Append new assistant message
        const updatedMessages = [...existingMessages, assistantMessage]

        // Apply sliding window
        const messagesToPersist = this.applySlidingWindow(updatedMessages, inputs.slidingWindowSize)

        // Persist entire array (UPSERT is fine here since we're replacing with windowed data)
        await this.persistToMemoryAPI(ctx.workflowId, memoryKey, messagesToPersist)
      } else {
        // Use atomic append for non-windowed memory
        await this.atomicAppendToMemory(ctx.workflowId, memoryKey, assistantMessage)
      }

      logger.debug('Successfully persisted memory message', {
        workflowId: ctx.workflowId,
        key: memoryKey,
      })
    } catch (error) {
      logger.error('Failed to persist memory message:', error)
      // Don't throw - memory persistence failure shouldn't break workflow execution
    }
  }

  /**
   * Persist user message to memory before agent execution
   * This ensures the conversation history is complete
   * Uses atomic append operations to prevent race conditions
   */
  async persistUserMessage(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    userMessage: Message
  ): Promise<void> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return
    }

    if (!ctx.workflowId) {
      logger.warn('Cannot persist user message without workflowId')
      return
    }

    try {
      const memoryKey = this.buildMemoryKey(ctx, inputs)

      // For sliding window, we need to fetch and recompute
      // For other memory types, use atomic append
      if (inputs.slidingWindowSize && inputs.memoryType === 'sliding_window') {
        const existingMessages = await this.fetchFromMemoryAPI(ctx.workflowId, memoryKey)
        const updatedMessages = [...existingMessages, userMessage]
        const messagesToPersist = this.applySlidingWindow(updatedMessages, inputs.slidingWindowSize)
        await this.persistToMemoryAPI(ctx.workflowId, memoryKey, messagesToPersist)
      } else {
        // Use atomic append for non-windowed memory
        await this.atomicAppendToMemory(ctx.workflowId, memoryKey, userMessage)
      }
    } catch (error) {
      logger.error('Failed to persist user message:', error)
    }
  }

  /**
   * Build memory key based on memoryType and conversationId
   */
  private buildMemoryKey(ctx: ExecutionContext, inputs: AgentInputs): string {
    const { memoryType, conversationId } = inputs

    switch (memoryType) {
      case 'conversation_id':
        if (!conversationId) {
          logger.warn('conversationId required for conversation_id memory type, using default')
          return `conversation:default:${ctx.workflowId}`
        }
        return `conversation:${conversationId}:${ctx.workflowId}`

      case 'all_conversations':
        return `workflow:${ctx.workflowId}:all_conversations`

      case 'sliding_window':
        // Same as all_conversations but with limited retrieval
        return `workflow:${ctx.workflowId}:sliding_window`

      default:
        return `workflow:${ctx.workflowId}:agent_memory`
    }
  }

  /**
   * Apply sliding window to limit number of conversation messages
   * System messages are kept separately and don't count toward the window size
   * Following industry standard: window = N recent conversation messages (user/assistant)
   */
  private applySlidingWindow(messages: Message[], windowSize: string): Message[] {
    const limit = Number.parseInt(windowSize, 10)

    if (Number.isNaN(limit) || limit <= 0) {
      logger.warn('Invalid sliding window size, returning all messages', { windowSize })
      return messages
    }

    // Separate system messages from conversation messages
    // System messages are kept outside the sliding window (industry standard)
    const systemMessages = messages.filter((msg) => msg.role === 'system')
    const conversationMessages = messages.filter((msg) => msg.role !== 'system')

    // Take last N conversation messages (most recent)
    const recentMessages = conversationMessages.slice(-limit)

    // Reconstruct: ONLY FIRST system message + recent conversation
    // Multiple system messages in history are consolidated to one
    const firstSystemMessage = systemMessages.length > 0 ? [systemMessages[0]] : []

    return [...firstSystemMessage, ...recentMessages]
  }

  /**
   * Fetch messages from memory API
   */
  private async fetchFromMemoryAPI(workflowId: string, key: string): Promise<Message[]> {
    try {
      const isBrowser = typeof window !== 'undefined'

      if (!isBrowser) {
        // Server-side: Direct database access
        return await this.fetchFromMemoryDirect(workflowId, key)
      }

      // Browser-side: Use API
      const headers = await buildAuthHeaders()
      const url = buildAPIUrl('/api/memory', { workflowId, key })

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
      })

      if (!response.ok) {
        if (response.status === 404) {
          // No memory found - return empty array (first conversation)
          return []
        }
        throw new Error(`Failed to fetch memory: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch memory')
      }

      // Extract messages from memory data
      const memoryData = result.data?.data || result.data
      if (Array.isArray(memoryData)) {
        return memoryData.filter(
          (msg) => msg && typeof msg === 'object' && 'role' in msg && 'content' in msg
        )
      }

      return []
    } catch (error) {
      logger.error('Error fetching from memory API:', error)
      return []
    }
  }

  /**
   * Direct database access for server-side execution
   */
  private async fetchFromMemoryDirect(workflowId: string, key: string): Promise<Message[]> {
    try {
      const { db } = await import('@sim/db')
      const { memory } = await import('@sim/db/schema')
      const { and, eq } = await import('drizzle-orm')

      const result = await db
        .select({
          data: memory.data,
          type: memory.type,
        })
        .from(memory)
        .where(and(eq(memory.workflowId, workflowId), eq(memory.key, key)))
        .limit(1)

      if (result.length === 0) {
        return []
      }

      const memoryData = result[0].data as any
      if (Array.isArray(memoryData)) {
        return memoryData.filter(
          (msg) => msg && typeof msg === 'object' && 'role' in msg && 'content' in msg
        )
      }

      return []
    } catch (error) {
      logger.error('Error fetching from memory database:', error)
      return []
    }
  }

  /**
   * Persist messages to memory API
   */
  private async persistToMemoryAPI(
    workflowId: string,
    key: string,
    messages: Message[]
  ): Promise<void> {
    try {
      const isBrowser = typeof window !== 'undefined'

      if (!isBrowser) {
        // Server-side: Direct database access
        await this.persistToMemoryDirect(workflowId, key, messages)
        return
      }

      // Browser-side: Use API
      const headers = await buildAuthHeaders()
      const url = buildAPIUrl('/api/memory')

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: stringifyJSON({
          workflowId,
          key,
          type: 'agent',
          data: messages,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to persist memory: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to persist memory')
      }
    } catch (error) {
      logger.error('Error persisting to memory API:', error)
      throw error
    }
  }

  /**
   * Atomically append a message to memory
   * This prevents race conditions by using database-level JSONB append operations
   */
  private async atomicAppendToMemory(
    workflowId: string,
    key: string,
    message: Message
  ): Promise<void> {
    try {
      const isBrowser = typeof window !== 'undefined'

      if (!isBrowser) {
        // Server-side: Use direct database atomic append
        await this.atomicAppendToMemoryDirect(workflowId, key, message)
      } else {
        // Browser-side: Use API (will be handled by API endpoint)
        const headers = await buildAuthHeaders()
        const url = buildAPIUrl('/api/memory')

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: stringifyJSON({
            workflowId,
            key,
            type: 'agent',
            data: message, // API will handle appending
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to append memory: ${response.status} ${response.statusText}`)
        }

        const result = await response.json()

        if (!result.success) {
          throw new Error(result.error || 'Failed to append memory')
        }
      }
    } catch (error) {
      logger.error('Error appending to memory:', error)
      throw error
    }
  }

  /**
   * Direct database atomic append for server-side
   * Uses PostgreSQL JSONB concatenation operator for atomic operations
   */
  private async atomicAppendToMemoryDirect(
    workflowId: string,
    key: string,
    message: Message
  ): Promise<void> {
    try {
      const { db } = await import('@sim/db')
      const { memory } = await import('@sim/db/schema')
      const { sql } = await import('drizzle-orm')
      const { randomUUID } = await import('node:crypto')

      const now = new Date()
      const id = randomUUID()

      // Try to atomically append using JSONB concatenation
      // This SQL: data = data || '[{new_message}]'::jsonb
      // If no row exists, insert will create one
      await db
        .insert(memory)
        .values({
          id,
          workflowId,
          key,
          type: 'agent',
          data: [message], // Initial array with single message
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [memory.workflowId, memory.key],
          set: {
            // Use SQL to atomically append: data || '[{message}]'::jsonb
            data: sql`${memory.data} || ${JSON.stringify([message])}::jsonb`,
            updatedAt: now,
          },
        })

      logger.debug('Atomically appended message to memory', {
        workflowId,
        key,
      })
    } catch (error) {
      logger.error('Error in atomic append to memory database:', error)
      throw error
    }
  }

  /**
   * Direct database access for server-side persistence
   * Uses UPSERT to handle race conditions atomically
   */
  private async persistToMemoryDirect(
    workflowId: string,
    key: string,
    messages: Message[]
  ): Promise<void> {
    try {
      const { db } = await import('@sim/db')
      const { memory } = await import('@sim/db/schema')
      const { randomUUID } = await import('node:crypto')

      const now = new Date()
      const id = randomUUID()

      // Use UPSERT (INSERT ... ON CONFLICT DO UPDATE) to atomically handle race conditions
      // This prevents lost updates when multiple requests try to persist simultaneously
      await db
        .insert(memory)
        .values({
          id,
          workflowId,
          key,
          type: 'agent',
          data: messages,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [memory.workflowId, memory.key],
          set: {
            data: messages,
            updatedAt: now,
          },
        })
    } catch (error) {
      logger.error('Error persisting to memory database:', error)
      throw error
    }
  }

  /**
   * Validate inputs to prevent malicious data or performance issues
   */
  private validateInputs(conversationId?: string, content?: string): void {
    // Validate conversation ID length
    if (conversationId && conversationId.trim() !== '') {
      if (conversationId.length > 255) {
        throw new Error('Conversation ID too long (max 255 characters)')
      }

      // Check for potentially problematic characters
      if (!/^[a-zA-Z0-9_\-:.@]+$/.test(conversationId)) {
        logger.warn('Conversation ID contains special characters', { conversationId })
      }
    }

    // Validate message content size
    if (content) {
      const contentSize = Buffer.byteLength(content, 'utf8')
      const MAX_CONTENT_SIZE = 100 * 1024 // 100KB

      if (contentSize > MAX_CONTENT_SIZE) {
        throw new Error(`Message content too large (${contentSize} bytes, max ${MAX_CONTENT_SIZE})`)
      }
    }
  }
}

// Export singleton instance
export const memoryService = new MemoryService()
