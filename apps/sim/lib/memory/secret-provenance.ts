import { memory, memorySecretProvenance } from '@sim/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import {
  type DurableSecretProvenance,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  hashDurableSecretProvenanceValue,
  normalizeDurableSecretProvenanceEntries,
} from '@/lib/execution/durable-secret-provenance'

interface MemorySecretProvenanceRow {
  secretProvenanceVersion: number | null
  data: unknown
  provenanceContentHash: string | null
  status: string | null
  entries: unknown
}

/** Classifies a joined memory/sidecar row without treating malformed tracked data as public. */
export function readBoundMemorySecretProvenance(
  row: MemorySecretProvenanceRow
): DurableSecretProvenance {
  if (row.secretProvenanceVersion === null) {
    return EXACT_EMPTY_DURABLE_SECRET_PROVENANCE
  }
  const contentHash = hashDurableSecretProvenanceValue(row.data)
  if (
    row.secretProvenanceVersion !== 1 ||
    row.status !== 'exact' ||
    !contentHash ||
    row.provenanceContentHash !== contentHash
  ) {
    return { status: 'unknown' }
  }
  const entries = normalizeDurableSecretProvenanceEntries(row.entries)
  return entries ? { status: 'exact', entries } : { status: 'unknown' }
}

/** Atomically binds a private sidecar to the exact memory JSON version just written. */
export async function replaceMemorySecretProvenanceInTx(
  tx: DbTransaction,
  memoryId: string,
  data: unknown,
  provenance: DurableSecretProvenance
): Promise<void> {
  const contentHash = hashDurableSecretProvenanceValue(data)
  const entries =
    contentHash && provenance.status === 'exact'
      ? normalizeDurableSecretProvenanceEntries(provenance.entries)
      : []
  const status = contentHash && provenance.status === 'exact' && entries ? 'exact' : 'unknown'
  await tx
    .insert(memorySecretProvenance)
    .values({
      memoryId,
      contentHash: contentHash ?? 'unavailable',
      status,
      entries: entries ?? [],
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: memorySecretProvenance.memoryId,
      set: {
        contentHash: contentHash ?? 'unavailable',
        status,
        entries: entries ?? [],
        updatedAt: new Date(),
      },
    })

  const [tracked] = await tx
    .update(memory)
    .set({ secretProvenanceVersion: 1 })
    .where(
      and(
        eq(memory.id, memoryId),
        or(isNull(memory.secretProvenanceVersion), eq(memory.secretProvenanceVersion, 1))
      )
    )
    .returning({ id: memory.id })
  if (!tracked) throw new Error('Memory secret provenance could not bind the persisted version')
}
