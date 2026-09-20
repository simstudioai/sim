import { createHash } from 'node:crypto'
import {
  MAX_MEMORY_CHECKPOINT_BYTES,
  projectableMemoryCheckpoint,
} from '@/lib/memory/checkpoint-codec'

/** Missing or oversized prefixes cannot prove a Bedrock reasoning signature's request binding. */
export function getConversationPrefixHash(messages: readonly unknown[]): string | undefined {
  try {
    const encoded = JSON.stringify(projectableMemoryCheckpoint(messages))
    if (Buffer.byteLength(encoded, 'utf8') > MAX_MEMORY_CHECKPOINT_BYTES) return undefined
    return createHash('sha256').update(encoded).digest('hex')
  } catch {
    return undefined
  }
}
