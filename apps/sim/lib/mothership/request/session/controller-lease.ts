import { getRedisClient } from '@/lib/core/config/redis'

/** The chat admission lock also fences successive controllers of the same run. */
export interface ChatStreamLease {
  key: string
  value: string
}

export class StreamControllerSupersededError extends Error {
  constructor() {
    super('Stream controller no longer owns this chat')
    this.name = 'StreamControllerSupersededError'
  }
}

export function chatStreamLockKey(chatId: string): string {
  return `copilot:chat-stream-lock:${chatId}`
}

export function streamIdFromLock(value: string): string {
  return value.split('\n', 1)[0]
}

export async function assertChatStreamLease(lease: ChatStreamLease): Promise<void> {
  const redis = getRedisClient()
  if (!redis || (await redis.get(lease.key)) !== lease.value) {
    throw new StreamControllerSupersededError()
  }
}

/** Whether this lease still holds its chat lock; an unreadable lock counts as lost. */
export async function holdsChatStreamLease(lease: ChatStreamLease): Promise<boolean> {
  try {
    await assertChatStreamLease(lease)
    return true
  } catch {
    return false
  }
}
