import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('CopilotOrchestratorPersistence')

/**
 * Create a new copilot chat record.
 */
export async function createChat(params: {
  userId: string
  workflowId: string
  model: string
}): Promise<{ id: string }> {
  const [chat] = await db
    .insert(copilotChats)
    .values({
      userId: params.userId,
      workflowId: params.workflowId,
      model: params.model,
      messages: [],
    })
    .returning({ id: copilotChats.id })

  return { id: chat.id }
}

/**
 * Load an existing chat for a user.
 */
export async function loadChat(chatId: string, userId: string) {
  const [chat] = await db
    .select()
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
    .limit(1)

  return chat || null
}

/**
 * Save chat messages and metadata.
 */
export async function saveMessages(
  chatId: string,
  messages: any[],
  options?: {
    title?: string
    conversationId?: string
    planArtifact?: string | null
    config?: { mode?: string; model?: string }
  }
): Promise<void> {
  await db
    .update(copilotChats)
    .set({
      messages,
      updatedAt: new Date(),
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options?.planArtifact !== undefined ? { planArtifact: options.planArtifact } : {}),
      ...(options?.config ? { config: options.config } : {}),
    })
    .where(eq(copilotChats.id, chatId))
}

/**
 * Update the conversationId for a chat without overwriting messages.
 */
export async function updateChatConversationId(
  chatId: string,
  conversationId: string
): Promise<void> {
  await db
    .update(copilotChats)
    .set({
      conversationId,
      updatedAt: new Date(),
    })
    .where(eq(copilotChats.id, chatId))
}

/**
 * Set a tool call confirmation status in Redis.
 */
export async function setToolConfirmation(
  toolCallId: string,
  status: 'accepted' | 'rejected' | 'background' | 'pending',
  message?: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis client not available for tool confirmation')
    return false
  }

  const key = `tool_call:${toolCallId}`
  const payload = {
    status,
    message: message || null,
    timestamp: new Date().toISOString(),
  }

  try {
    await redis.set(key, JSON.stringify(payload), 'EX', 86400)
    return true
  } catch (error) {
    logger.error('Failed to set tool confirmation', {
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Get a tool call confirmation status from Redis.
 */
export async function getToolConfirmation(toolCallId: string): Promise<{
  status: string
  message?: string
  timestamp?: string
} | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const data = await redis.get(`tool_call:${toolCallId}`)
    if (!data) return null
    return JSON.parse(data) as { status: string; message?: string; timestamp?: string }
  } catch (error) {
    logger.error('Failed to read tool confirmation', {
      toolCallId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
