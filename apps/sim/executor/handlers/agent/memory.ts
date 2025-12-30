import { randomUUID } from 'node:crypto'
import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { getAccurateTokenCount } from '@/lib/tokenization/estimators'
import { MEMORY } from '@/executor/constants'
import type { AgentInputs, Message } from '@/executor/handlers/agent/types'
import type { ExecutionContext } from '@/executor/types'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

const logger = createLogger('Memory')

export class Memory {
  async fetchMemoryMessages(ctx: ExecutionContext, inputs: AgentInputs): Promise<Message[]> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return []
    }

    const workspaceId = this.requireWorkspaceId(ctx)
    this.validateConversationId(inputs.conversationId)

    const messages = await this.fetchMemory(workspaceId, inputs.conversationId!)

    switch (inputs.memoryType) {
      case 'conversation':
        return this.applyContextWindowLimit(messages, inputs.model)

      case 'sliding_window': {
        const limit = this.parsePositiveInt(
          inputs.slidingWindowSize,
          MEMORY.DEFAULT_SLIDING_WINDOW_SIZE
        )
        return this.applyWindow(messages, limit)
      }

      case 'sliding_window_tokens': {
        const maxTokens = this.parsePositiveInt(
          inputs.slidingWindowTokens,
          MEMORY.DEFAULT_SLIDING_WINDOW_TOKENS
        )
        return this.applyTokenWindow(messages, maxTokens, inputs.model)
      }

      default:
        return messages
    }
  }

  async appendToMemory(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    message: Message
  ): Promise<void> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return
    }

    const workspaceId = this.requireWorkspaceId(ctx)
    this.validateConversationId(inputs.conversationId)
    this.validateContent(message.content)

    const key = inputs.conversationId!

    await this.appendMessage(workspaceId, key, message)

    logger.debug('Appended message to memory', {
      workspaceId,
      key,
      role: message.role,
    })
  }

  async seedMemory(ctx: ExecutionContext, inputs: AgentInputs, messages: Message[]): Promise<void> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return
    }

    const workspaceId = this.requireWorkspaceId(ctx)

    const conversationMessages = messages.filter((m) => m.role !== 'system')
    if (conversationMessages.length === 0) {
      return
    }

    this.validateConversationId(inputs.conversationId)

    const key = inputs.conversationId!

    let messagesToStore = conversationMessages
    if (inputs.memoryType === 'sliding_window') {
      const limit = this.parsePositiveInt(
        inputs.slidingWindowSize,
        MEMORY.DEFAULT_SLIDING_WINDOW_SIZE
      )
      messagesToStore = this.applyWindow(conversationMessages, limit)
    } else if (inputs.memoryType === 'sliding_window_tokens') {
      const maxTokens = this.parsePositiveInt(
        inputs.slidingWindowTokens,
        MEMORY.DEFAULT_SLIDING_WINDOW_TOKENS
      )
      messagesToStore = this.applyTokenWindow(conversationMessages, maxTokens, inputs.model)
    }

    await this.seedMemoryRecord(workspaceId, key, messagesToStore)

    logger.debug('Seeded memory', {
      workspaceId,
      key,
      count: messagesToStore.length,
    })
  }

  wrapStreamForPersistence(
    stream: ReadableStream<Uint8Array>,
    ctx: ExecutionContext,
    inputs: AgentInputs
  ): ReadableStream<Uint8Array> {
    let accumulatedContent = ''
    const decoder = new TextDecoder()

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        controller.enqueue(chunk)
        const decoded = decoder.decode(chunk, { stream: true })
        accumulatedContent += decoded
      },

      flush: () => {
        if (accumulatedContent.trim()) {
          this.appendToMemory(ctx, inputs, {
            role: 'assistant',
            content: accumulatedContent,
          }).catch((error) => logger.error('Failed to persist streaming response:', error))
        }
      },
    })

    return stream.pipeThrough(transformStream)
  }

  private requireWorkspaceId(ctx: ExecutionContext): string {
    if (!ctx.workspaceId) {
      throw new Error('workspaceId is required for memory operations')
    }
    return ctx.workspaceId
  }

  private applyWindow(messages: Message[], limit: number): Message[] {
    return messages.slice(-limit)
  }

  private applyTokenWindow(messages: Message[], maxTokens: number, model?: string): Message[] {
    const result: Message[] = []
    let tokenCount = 0

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const msgTokens = getAccurateTokenCount(msg.content, model)

      if (tokenCount + msgTokens <= maxTokens) {
        result.unshift(msg)
        tokenCount += msgTokens
      } else if (result.length === 0) {
        result.unshift(msg)
        break
      } else {
        break
      }
    }

    return result
  }

  private applyContextWindowLimit(messages: Message[], model?: string): Message[] {
    if (!model) return messages

    for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
      if (provider.contextInformationAvailable === false) continue

      const matchesPattern = provider.modelPatterns?.some((p) => p.test(model))
      const matchesModel = provider.models.some((m) => m.id === model)

      if (matchesPattern || matchesModel) {
        const modelDef = provider.models.find((m) => m.id === model)
        if (modelDef?.contextWindow) {
          const maxTokens = Math.floor(modelDef.contextWindow * MEMORY.CONTEXT_WINDOW_UTILIZATION)
          return this.applyTokenWindow(messages, maxTokens, model)
        }
      }
    }

    return messages
  }

  private async fetchMemory(workspaceId: string, key: string): Promise<Message[]> {
    const result = await db
      .select({ data: memory.data })
      .from(memory)
      .where(and(eq(memory.workspaceId, workspaceId), eq(memory.key, key)))
      .limit(1)

    if (result.length === 0) return []

    const data = result[0].data
    if (!Array.isArray(data)) return []

    return data.filter(
      (msg): msg is Message => msg && typeof msg === 'object' && 'role' in msg && 'content' in msg
    )
  }

  private async seedMemoryRecord(
    workspaceId: string,
    key: string,
    messages: Message[]
  ): Promise<void> {
    const now = new Date()

    await db
      .insert(memory)
      .values({
        id: randomUUID(),
        workspaceId,
        key,
        data: messages,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
  }

  private async appendMessage(workspaceId: string, key: string, message: Message): Promise<void> {
    const now = new Date()

    await db
      .insert(memory)
      .values({
        id: randomUUID(),
        workspaceId,
        key,
        data: [message],
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memory.workspaceId, memory.key],
        set: {
          data: sql`${memory.data} || ${JSON.stringify([message])}::jsonb`,
          updatedAt: now,
        },
      })
  }

  private parsePositiveInt(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed) || parsed <= 0) return defaultValue
    return parsed
  }

  private validateConversationId(conversationId?: string): void {
    if (!conversationId || conversationId.trim() === '') {
      throw new Error('Conversation ID is required')
    }
    if (conversationId.length > MEMORY.MAX_CONVERSATION_ID_LENGTH) {
      throw new Error(
        `Conversation ID too long (max ${MEMORY.MAX_CONVERSATION_ID_LENGTH} characters)`
      )
    }
  }

  private validateContent(content: string): void {
    const size = Buffer.byteLength(content, 'utf8')
    if (size > MEMORY.MAX_MESSAGE_CONTENT_BYTES) {
      throw new Error(
        `Message content too large (${size} bytes, max ${MEMORY.MAX_MESSAGE_CONTENT_BYTES})`
      )
    }
  }
}

export const memoryService = new Memory()
