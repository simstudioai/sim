import { dbFor } from '@sim/db'
import { memory } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

export const MAX_MEMORY_SUMMARY_CHARS = 6000
const MAX_ENCRYPTED_SUMMARY_BYTES = 64 * 1024

export interface MemorySummaryScope {
  workspaceId: string
  memoryId: string
  sourceHash: string
}

export interface SaveMemorySummaryInput extends MemorySummaryScope {
  content: string
  sourceMessageCount: number
}

function predicate(scope: MemorySummaryScope) {
  return and(
    eq(memory.id, scope.memoryId),
    eq(memory.workspaceId, scope.workspaceId),
    isNull(memory.deletedAt)
  )
}

function validateHash(hash: string): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid memory summary source hash')
}

/** Only an exact source match may reuse this derived cache; old windows cannot revive through it. */
export async function readMemorySummary(scope: MemorySummaryScope): Promise<string | undefined> {
  validateHash(scope.sourceHash)
  const [row] = await dbFor('exec')
    .select({
      value: sql<
        string | null
      >`CASE WHEN octet_length(${memory.encryptedContextSummary}) <= ${MAX_ENCRYPTED_SUMMARY_BYTES} THEN ${memory.encryptedContextSummary} ELSE NULL END`,
    })
    .from(memory)
    .where(predicate(scope))
    .limit(1)
  if (!row?.value) return undefined
  const { decrypted } = await decryptSecret(row.value, { logFailure: false })
  const value: unknown = JSON.parse(decrypted)
  if (
    !isRecordLike(value) ||
    value.version !== 1 ||
    value.memoryId !== scope.memoryId ||
    value.sourceHash !== scope.sourceHash ||
    typeof value.content !== 'string' ||
    value.content.length > MAX_MEMORY_SUMMARY_CHARS
  )
    return undefined
  return value.content
}

/** A single guarded row update replaces the cache without touching conversation data or provenance. */
export async function saveMemorySummary(input: SaveMemorySummaryInput): Promise<void> {
  validateHash(input.sourceHash)
  if (
    !input.content.trim() ||
    input.content.length > MAX_MEMORY_SUMMARY_CHARS ||
    !Number.isSafeInteger(input.sourceMessageCount) ||
    input.sourceMessageCount < 1
  )
    throw new Error('Invalid memory summary')
  const { encrypted } = await encryptSecret(
    JSON.stringify({
      version: 1,
      memoryId: input.memoryId,
      sourceHash: input.sourceHash,
      sourceMessageCount: input.sourceMessageCount,
      content: input.content,
    })
  )
  if (Buffer.byteLength(encrypted, 'utf8') > MAX_ENCRYPTED_SUMMARY_BYTES)
    throw new Error('Memory summary exceeds its storage limit')
  await dbFor('exec')
    .update(memory)
    .set({ encryptedContextSummary: encrypted })
    .where(predicate(input))
}
