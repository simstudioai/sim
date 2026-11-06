import type { DurableSecretProvenanceEntry } from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import type { DurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import { SecretProvenanceBudget } from '@/lib/execution/provenance-budget'
import { PROVENANCE_MAX_SERIALIZED_BYTES } from '@/lib/execution/provenance-limits'

/** Normalizes and folds streamed durable bindings within the existing provenance budget. */
export function normalizeDurableSecretProvenanceBindings(
  candidates: Iterable<unknown>
): DurableSecretProvenanceEntry[] | undefined {
  const entries = new Map<string, DurableSecretProvenanceEntry>()
  const budget = new SecretProvenanceBudget()
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
    const record = candidate as Record<string, unknown>
    if (
      typeof record.encryptedValue !== 'string' ||
      record.encryptedValue.length === 0 ||
      (record.name !== undefined && typeof record.name !== 'string') ||
      (record.sourceUserId !== undefined && typeof record.sourceUserId !== 'string') ||
      (record.sourceWorkspaceId !== undefined && typeof record.sourceWorkspaceId !== 'string') ||
      (record.sourceValueHash !== undefined && typeof record.sourceValueHash !== 'string') ||
      (record.sourceWorkspaceId !== undefined && record.sourceUserId === undefined)
    ) {
      return undefined
    }
    const entry: DurableSecretProvenanceEntry = {
      encryptedValue: record.encryptedValue,
      ...(typeof record.name === 'string' && record.name.length > 0 ? { name: record.name } : {}),
      ...(typeof record.sourceUserId === 'string' && record.sourceUserId.length > 0
        ? { sourceUserId: record.sourceUserId }
        : {}),
      ...(typeof record.sourceWorkspaceId === 'string' && record.sourceWorkspaceId.length > 0
        ? { sourceWorkspaceId: record.sourceWorkspaceId }
        : {}),
      ...(typeof record.sourceValueHash === 'string' && record.sourceValueHash.length > 0
        ? { sourceValueHash: record.sourceValueHash }
        : {}),
    }
    let minimumBytes = 0
    for (const field of Object.values(entry)) {
      minimumBytes += Buffer.byteLength(field, 'utf8')
      if (minimumBytes > PROVENANCE_MAX_SERIALIZED_BYTES) return undefined
    }
    const key = JSON.stringify(entry)
    if (entries.has(key)) continue
    if (!budget.add(entry.encryptedValue, Buffer.byteLength(key, 'utf8'))) return undefined
    entries.set(key, entry)
  }

  return [...entries.values()].sort(
    (left, right) =>
      compareStrings(left.sourceUserId ?? '', right.sourceUserId ?? '') ||
      compareStrings(left.sourceWorkspaceId ?? '', right.sourceWorkspaceId ?? '') ||
      compareStrings(left.sourceValueHash ?? '', right.sourceValueHash ?? '') ||
      compareStrings(left.name ?? '', right.name ?? '') ||
      compareStrings(left.encryptedValue, right.encryptedValue)
  )
}

/** Merges streamed source evidence within the shared budget without materializing the sources. */
export function mergeDurableSecretProvenanceSources(
  values: Iterable<DurableSecretProvenance>
): DurableSecretProvenance {
  let unknown = false
  const normalized = normalizeDurableSecretProvenanceBindings(
    (function* () {
      for (const value of values) {
        if (value.status === 'unknown') {
          unknown = true
          return
        }
        yield* value.entries
      }
    })()
  )
  return !unknown && normalized ? { status: 'exact', entries: normalized } : { status: 'unknown' }
}
