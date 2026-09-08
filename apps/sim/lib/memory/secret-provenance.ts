import { type DurableSecretProvenanceEntry, memory, memorySecretProvenance } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'
import type { DbTransaction } from '@/lib/db/types'
import {
  type DurableSecretProvenance,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  hashDurableSecretProvenanceValue,
  importDurableSecretProvenance,
  normalizeDurableSecretProvenanceEntries,
} from '@/lib/execution/durable-secret-provenance'
import { SecretProvenanceBudget } from '@/lib/execution/provenance-budget'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('MemorySecretProvenance')

type MemoryProvenanceRecoveryCause = 'unbound-message-entry' | 'unmatched-message-hash'
type MemoryUnknownWriteCause =
  | 'incoming-provenance-incomplete'
  | 'inherited-provenance-unknown'
  | 'merge-provenance-limit'

interface MemorySecretProvenanceSelection {
  select(messages: readonly unknown[], includeRecovered: boolean): DurableSecretProvenance
  recoveredEntryCount: number
}

/**
 * Known message bindings still respect the selected history window. Older writers omitted the
 * binding or hashed a message before removing its files; retain those entries for value-filtered
 * redaction instead of silently declaring their content public.
 */
export async function createMemorySecretProvenanceSelector(
  provenance: DurableSecretProvenance,
  storedMessages: readonly unknown[],
  workspaceId?: string
): Promise<MemorySecretProvenanceSelection> {
  if (provenance.status === 'unknown') return { select: () => provenance, recoveredEntryCount: 0 }

  const storedHashes = new Set(storedMessages.map(hashDurableSecretProvenanceValue))
  const recoveryCounts = new Map<MemoryProvenanceRecoveryCause, number>()
  const recoveredEntries: DurableSecretProvenanceEntry[] = []
  const optionalEntries = new Set<DurableSecretProvenanceEntry>()
  const recoveryByCiphertext = new Map<string, boolean>()
  let failedEntryCount = 0
  for (const entry of provenance.entries) {
    const cause = !entry.sourceValueHash
      ? 'unbound-message-entry'
      : !storedHashes.has(entry.sourceValueHash)
        ? 'unmatched-message-hash'
        : undefined
    if (cause) {
      let recoverable = recoveryByCiphertext.get(entry.encryptedValue)
      if (recoverable === undefined) {
        try {
          const { decrypted } = await decryptSecret(entry.encryptedValue, { logFailure: false })
          const staged = new ResolvedSecretTraceRegistry(
            [
              {
                name: 'MEMORY_RECOVERY',
                plaintext: decrypted,
                encryptedValue: entry.encryptedValue,
              },
            ],
            undefined,
            { staged: true }
          )
          recoverable = staged.recordResolved('MEMORY_RECOVERY', decrypted) && staged.isComplete()
        } catch {
          recoverable = false
        }
        recoveryByCiphertext.set(entry.encryptedValue, recoverable)
      }
      if (!recoverable) {
        failedEntryCount += 1
        continue
      }
      recoveryCounts.set(cause, (recoveryCounts.get(cause) ?? 0) + 1)
      optionalEntries.add(entry)
    }
    recoveredEntries.push(entry)
  }
  if (failedEntryCount > 0) {
    logger.error('Historical memory secret provenance could not be recovered', {
      surface: 'memory',
      cause: 'legacy-entry-recovery-failed',
      entryCount: failedEntryCount,
      ...(workspaceId ? { workspaceId } : {}),
    })
  }
  for (const [cause, entryCount] of recoveryCounts) {
    logger.error('Validated historical memory secret provenance', {
      surface: 'memory',
      cause,
      entryCount,
      ...(workspaceId ? { workspaceId } : {}),
    })
  }

  return {
    recoveredEntryCount: optionalEntries.size,
    select(messages, includeRecovered) {
      const selectedHashes = new Set(messages.map(hashDurableSecretProvenanceValue))
      return {
        status: 'exact',
        entries: recoveredEntries.filter((entry) =>
          optionalEntries.has(entry) ? includeRecovered : selectedHashes.has(entry.sourceValueHash)
        ),
      }
    },
  }
}

/** Binds a tool's whole-input provenance to the individual messages it actually persists. */
export async function bindMemorySecretProvenanceToMessages(
  messages: readonly unknown[],
  provenance: DurableSecretProvenance
): Promise<DurableSecretProvenance> {
  if (provenance.status === 'unknown' || provenance.entries.length === 0) return provenance

  const registry = new ResolvedSecretTraceRegistry()
  if (!(await importDurableSecretProvenance(registry, provenance, messages, 'memory'))) {
    return { status: 'unknown' }
  }
  const entries = new Map<string, (typeof provenance.entries)[number]>()
  const budget = new SecretProvenanceBudget()
  for (const message of messages) {
    const sourceValueHash = hashDurableSecretProvenanceValue(message)
    if (!sourceValueHash) {
      logger.error('Memory message secret provenance could not be bound', {
        surface: 'memory',
        cause: 'hash-unavailable',
      })
      return { status: 'unknown' }
    }
    const selected = registry.exportCommittedProvenanceForValue(message)
    if (!selected.complete) return { status: 'unknown' }
    const ciphertexts = new Set(selected.entries.map((entry) => entry.encryptedValue))
    for (const entry of provenance.entries) {
      if (!ciphertexts.has(entry.encryptedValue)) continue
      const bound = { ...entry, sourceValueHash }
      const key = JSON.stringify(bound)
      if (entries.has(key)) continue
      if (!budget.add(entry.encryptedValue, Buffer.byteLength(key, 'utf8'))) {
        logger.error('Memory message secret provenance could not be bound', {
          surface: 'memory',
          cause: 'entries-unnormalizable',
        })
        return { status: 'unknown' }
      }
      entries.set(key, bound)
    }
  }
  const normalized = normalizeDurableSecretProvenanceEntries([...entries.values()])
  if (!normalized) {
    logger.error('Memory message secret provenance could not be bound', {
      surface: 'memory',
      cause: 'entries-unnormalizable',
    })
  }
  return normalized ? { status: 'exact', entries: normalized } : { status: 'unknown' }
}

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
  provenance: DurableSecretProvenance,
  unknownCause: MemoryUnknownWriteCause = 'incoming-provenance-incomplete'
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
  /** This transaction can still roll back; report staged writes rather than claiming commitment. */
  if (status === 'unknown') {
    logger.error('Memory write staged unrecorded secret provenance', {
      surface: 'memory',
      cause:
        provenance.status === 'unknown'
          ? unknownCause
          : contentHash
            ? 'entries-unnormalizable'
            : 'hash-unavailable',
      memoryId,
    })
  }
}
