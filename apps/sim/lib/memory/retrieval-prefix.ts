import { dbFor } from '@sim/db'
import { memory, memorySecretProvenance } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import type { MemoryArtifactScope } from '@/lib/memory/artifacts'
import { stringifyBoundedMemoryJson } from '@/lib/memory/bounded-json'
import { readBoundMemorySecretProvenance } from '@/lib/memory/secret-provenance'

export const MAX_MEMORY_RETRIEVAL_PREFIX_BYTES = 1024 * 1024

export type MemoryRetrievalPrefix =
  | { status: 'available'; messages: unknown[]; provenance: DurableSecretProvenance }
  | { status: 'oversized' | 'unavailable' | 'missing' }

/** Admits the frozen prefix and its provenance together in SQL before either reaches the process. */
export async function readMemoryRetrievalPrefix(
  scope: MemoryArtifactScope
): Promise<MemoryRetrievalPrefix> {
  const bytes = sql<number>`octet_length(${memory.data}::text) + octet_length(coalesce(${memorySecretProvenance.entries}, '[]'::jsonb)::text)`
  const [row] = await dbFor('exec')
    .select({
      bytes,
      data: sql<unknown>`CASE WHEN ${bytes} <= ${MAX_MEMORY_RETRIEVAL_PREFIX_BYTES} THEN ${memory.data} ELSE NULL END`,
      entries: sql<unknown>`CASE WHEN ${bytes} <= ${MAX_MEMORY_RETRIEVAL_PREFIX_BYTES} THEN ${memorySecretProvenance.entries} ELSE NULL END`,
      secretProvenanceVersion: memory.secretProvenanceVersion,
      provenanceContentHash: memorySecretProvenance.contentHash,
      status: memorySecretProvenance.status,
    })
    .from(memory)
    .leftJoin(memorySecretProvenance, eq(memorySecretProvenance.memoryId, memory.id))
    .where(
      and(
        eq(memory.id, scope.memoryId),
        eq(memory.workspaceId, scope.workspaceId),
        isNull(memory.deletedAt)
      )
    )
    .limit(1)
  if (!row) return { status: 'missing' }
  if (
    !Number.isSafeInteger(row.bytes) ||
    row.bytes < 0 ||
    row.bytes > MAX_MEMORY_RETRIEVAL_PREFIX_BYTES
  )
    return { status: 'oversized' }
  if (
    !Array.isArray(row.data) ||
    stringifyBoundedMemoryJson(row.data, MAX_MEMORY_RETRIEVAL_PREFIX_BYTES) === undefined
  )
    return { status: 'unavailable' }
  const provenance = readBoundMemorySecretProvenance(row)
  return provenance.status === 'exact'
    ? { status: 'available', messages: row.data, provenance }
    : { status: 'unavailable' }
}
