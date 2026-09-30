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

/**
 * The streams among these whose own controller holds its chat lock, under any token: a
 * recovering controller locks the chat before it claims the run. Throws when the locks
 * cannot be read, since then no stream is provably unowned.
 */
export async function findStreamsHoldingChatLock(
  streams: Array<{ chatId: string; streamId: string }>
): Promise<Set<string>> {
  const redis = getRedisClient()
  if (!redis) throw new Error('Chat stream locks are unreadable without Redis')
  if (streams.length === 0) return new Set()
  const values = await redis.mget(streams.map(({ chatId }) => chatStreamLockKey(chatId)))
  const held = new Set<string>()
  streams.forEach(({ streamId }, index) => {
    const value = values[index]
    if (value && streamIdFromLock(value) === streamId) held.add(streamId)
  })
  return held
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
