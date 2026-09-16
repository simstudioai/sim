import { createHash } from 'node:crypto'
import type { DurableSecretProvenanceEntry } from '@sim/db/schema'
import {
  type DurableSecretProvenanceSurface,
  isDurableSecretProvenanceEnforced,
  reportUnrecordedDurableProvenance,
} from '@/lib/execution/durable-secret-provenance-enforcement'
import {
  isPrivateSecretProvenanceBundleV1,
  type PrivateSecretProvenanceBundleV1,
} from '@/lib/execution/model-input-provenance'
import { SecretProvenanceBudget } from '@/lib/execution/provenance-budget'
import { PROVENANCE_MAX_SERIALIZED_BYTES } from '@/lib/execution/provenance-limits'
import {
  type ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
  type ResolvedSecretTraceScopeV1,
} from '@/executor/utils/resolved-secret-trace-registry'

const MAX_DURABLE_HASH_DEPTH = 100
const MAX_DURABLE_HASH_BYTES = 16 * 1024 * 1024

export type DurableSecretProvenance =
  | { status: 'exact'; entries: readonly DurableSecretProvenanceEntry[] }
  | { status: 'unknown' }

export const EXACT_EMPTY_DURABLE_SECRET_PROVENANCE = Object.freeze({
  status: 'exact' as const,
  entries: Object.freeze([]),
})

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Normalizes one private sidecar payload and enforces the shared resource bounds. */
export function normalizeDurableSecretProvenanceEntries(
  value: unknown
): DurableSecretProvenanceEntry[] | undefined {
  return Array.isArray(value) ? normalizeDurableSecretProvenanceBindings(value) : undefined
}

function normalizeDurableSecretProvenanceBindings(
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

/** Converts a complete transport envelope into its scope-preserving durable representation. */
export function durableSecretProvenanceFromEnvelope(
  provenance: ResolvedSecretTraceProvenanceV1
): DurableSecretProvenance {
  if (!provenance.complete) return { status: 'unknown' }
  const normalized = normalizeDurableSecretProvenanceEntries(
    provenance.entries.map((entry) => ({
      encryptedValue: entry.encryptedValue,
      ...(entry.name ? { name: entry.name } : {}),
      ...(provenance.scope?.userId ? { sourceUserId: provenance.scope.userId } : {}),
      ...(provenance.scope?.workspaceId ? { sourceWorkspaceId: provenance.scope.workspaceId } : {}),
    }))
  )
  return normalized ? { status: 'exact', entries: normalized } : { status: 'unknown' }
}

/** Captures only committed exact values present in the persisted functional value. */
export function durableSecretProvenanceFromRegistry(
  registry: ResolvedSecretTraceRegistry | undefined,
  value: unknown
): DurableSecretProvenance {
  if (!registry) return { status: 'unknown' }
  return durableSecretProvenanceFromEnvelope(registry.exportCommittedProvenanceForValue(value))
}

/**
 * Checks whether a provenance source may cross into an already-authorized destination.
 * Workspace resources accept sources from any user in that same workspace; personal resources
 * remain restricted to the authenticated user and cannot accept workspace-scoped provenance.
 */
export function isPrivateSecretProvenanceScopeCompatible(
  sourceScope: ResolvedSecretTraceScopeV1 | undefined,
  destinationScope:
    | { workspaceId: string; userId?: string }
    | { userId: string; workspaceId?: undefined }
): sourceScope is ResolvedSecretTraceScopeV1 {
  if (!sourceScope) return false
  if (destinationScope.workspaceId !== undefined) {
    return sourceScope.workspaceId === destinationScope.workspaceId
  }
  return sourceScope.userId === destinationScope.userId && sourceScope.workspaceId === undefined
}

/** Reads one authenticated private selection without exposing it through the functional payload. */
export function durableSecretProvenanceFromPrivateBundle(
  value: unknown,
  selectionKey: string,
  destinationScope:
    | { workspaceId: string; userId?: string }
    | { userId: string; workspaceId?: undefined }
): DurableSecretProvenance | undefined {
  if (!isPrivateSecretProvenanceBundleV1(value)) return undefined
  const bundle: PrivateSecretProvenanceBundleV1 = value
  if (!bundle.complete) return { status: 'unknown' }
  const selections = bundle.selections.filter((candidate) => candidate.key === selectionKey)
  if (selections.length !== 1) {
    return undefined
  }
  const selection = selections[0]
  const scope = selection.provenance.scope
  if (!isPrivateSecretProvenanceScopeCompatible(scope, destinationScope)) {
    return undefined
  }
  return durableSecretProvenanceFromEnvelope(selection.provenance)
}

/** Combines contributing sources without broadening an unknown source into exact data. */
export function mergeDurableSecretProvenance(
  ...values: readonly DurableSecretProvenance[]
): DurableSecretProvenance {
  if (values.some((value) => value.status === 'unknown')) return { status: 'unknown' }
  const normalized = normalizeDurableSecretProvenanceBindings(
    (function* () {
      for (const value of values) {
        if (value.status === 'exact') yield* value.entries
      }
    })()
  )
  return normalized ? { status: 'exact', entries: normalized } : { status: 'unknown' }
}

/** Binds exact entries to one persisted sub-value so later slicing cannot activate dropped data. */
export function bindDurableSecretProvenanceToValue(
  provenance: DurableSecretProvenance,
  value: unknown
): DurableSecretProvenance {
  if (provenance.status === 'unknown') return provenance
  const sourceValueHash = hashDurableSecretProvenanceValue(value)
  if (!sourceValueHash) return { status: 'unknown' }
  const entries = normalizeDurableSecretProvenanceEntries(
    provenance.entries.map((entry) => ({ ...entry, sourceValueHash }))
  )
  return entries ? { status: 'exact', entries } : { status: 'unknown' }
}

/** Retains only entries explicitly bound to one of the selected sub-values. */
export function filterDurableSecretProvenanceBySourceValues(
  provenance: DurableSecretProvenance,
  values: readonly unknown[]
): DurableSecretProvenance {
  if (provenance.status === 'unknown') return provenance
  const hashes = values.map((value) => hashDurableSecretProvenanceValue(value))
  if (hashes.some((hash) => hash === undefined)) return { status: 'unknown' }
  const selectedHashes = new Set(hashes)
  const entries = normalizeDurableSecretProvenanceEntries(
    provenance.entries.filter(
      (entry) => entry.sourceValueHash && selectedHashes.has(entry.sourceValueHash)
    )
  )
  return entries ? { status: 'exact', entries } : { status: 'unknown' }
}

/**
 * Imports durable entries into a model-bound registry, preserving source-scope anonymity.
 *
 * `surface` selects the enforcement policy for provenance nobody recorded. Omitting it enforces,
 * which is the right default for a caller that has not been reviewed against
 * {@link isDurableSecretProvenanceEnforced} yet.
 */
export async function importDurableSecretProvenance(
  registry: ResolvedSecretTraceRegistry,
  provenance: DurableSecretProvenance,
  value?: unknown,
  surface?: DurableSecretProvenanceSurface,
  /**
   * Set by a caller that reports the whole read itself.
   *
   * This function sees one record and knows no workspace, so its report can only ever be a log
   * line, one per record. A caller reading a page can say the same thing once, with the workspace
   * and the count — which is the entry that reaches the people who own the secrets. Both reporting
   * would double-count the same event at two different granularities.
   */
  options: { reportUnrecorded?: boolean } = {}
): Promise<boolean> {
  if (provenance.status === 'unknown') {
    if (surface && !isDurableSecretProvenanceEnforced(surface)) {
      if (options.reportUnrecorded !== false) {
        reportUnrecordedDurableProvenance({ surface, cause: 'durable-provenance-unknown' })
      }
      return true
    }
    registry.markIncomplete('durable-provenance-unknown')
    return false
  }
  const entries = normalizeDurableSecretProvenanceEntries(provenance.entries)
  if (!entries) {
    /**
     * Malformed is not unrecorded: a sidecar that exists but cannot be parsed is a fault, and no
     * enforcement policy relaxes it.
     */
    registry.markIncomplete('durable-provenance-malformed')
    return false
  }

  const grouped = new Map<
    string,
    {
      scope?: ResolvedSecretTraceScopeV1
      entries: Map<string, ResolvedSecretTraceProvenanceV1['entries'][number]>
    }
  >()
  for (const entry of entries) {
    const scope = entry.sourceUserId
      ? {
          userId: entry.sourceUserId,
          ...(entry.sourceWorkspaceId ? { workspaceId: entry.sourceWorkspaceId } : {}),
        }
      : undefined
    const key = JSON.stringify(scope ?? null)
    let group = grouped.get(key)
    if (!group) {
      group = { scope, entries: new Map() }
      grouped.set(key, group)
    }
    const transportEntry = {
      encryptedValue: entry.encryptedValue,
      ...(entry.name ? { name: entry.name } : {}),
    }
    group.entries.set(JSON.stringify(transportEntry), transportEntry)
  }

  let complete = true
  for (const group of grouped.values()) {
    const envelope: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [...group.entries.values()],
      ...(group.scope ? { scope: group.scope } : {}),
    }
    const imported =
      value === undefined
        ? await registry.importProvenance(envelope, {
            trusted: true,
            origin: 'durableProvenance.envelope',
          })
        : await registry.importProvenanceForValue(envelope, value, {
            trusted: true,
            origin: 'durableProvenance.valueEnvelope',
          })
    complete = imported && complete
  }
  return complete && !registry.isPermanentlyIncomplete()
}

/** Creates a scoped registry for a tracked durable source immediately before model egress. */
export async function createDurableSecretProvenanceRegistry(
  provenance: DurableSecretProvenance,
  scope: ResolvedSecretTraceScopeV1
): Promise<ResolvedSecretTraceRegistry | undefined> {
  if (provenance.status === 'unknown') {
    throw new Error('Durable secret provenance is unavailable')
  }
  if (provenance.entries.length === 0) return undefined
  const registry = new ResolvedSecretTraceRegistry([], scope)
  if (!(await importDurableSecretProvenance(registry, provenance))) {
    throw new Error('Durable secret provenance is unavailable')
  }
  return registry
}

/**
 * Hashes a bounded plain-JSON value for sidecar freshness. Unsupported, cyclic,
 * accessor-backed, or oversized values return `undefined` so callers fail closed.
 */
export function hashDurableSecretProvenanceValue(value: unknown): string | undefined {
  const hash = createHash('sha256')
  const ancestors = new WeakSet<object>()
  let bytes = 0

  const append = (chunk: string): boolean => {
    bytes += Buffer.byteLength(chunk, 'utf8')
    if (bytes > MAX_DURABLE_HASH_BYTES) return false
    hash.update(chunk)
    return true
  }

  const visit = (candidate: unknown, depth: number): boolean => {
    if (depth > MAX_DURABLE_HASH_DEPTH) return false
    if (candidate === null) return append('null')
    if (typeof candidate === 'string') return append(JSON.stringify(candidate))
    if (typeof candidate === 'boolean') return append(candidate ? 'true' : 'false')
    if (typeof candidate === 'number') {
      return Number.isFinite(candidate) && append(JSON.stringify(candidate))
    }
    if (typeof candidate !== 'object') return false

    try {
      if (ancestors.has(candidate)) return false
      ancestors.add(candidate)
      if (Array.isArray(candidate)) {
        if (Object.getPrototypeOf(candidate) !== Array.prototype || !append('[')) return false
        const ownKeys = Reflect.ownKeys(candidate)
        if (
          ownKeys.some(
            (key) => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))
          )
        ) {
          return false
        }
        for (let index = 0; index < candidate.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index))
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false
          if (index > 0 && !append(',')) return false
          if (!visit(descriptor.value, depth + 1)) return false
        }
        return append(']')
      }

      const prototype = Object.getPrototypeOf(candidate)
      if ((prototype !== Object.prototype && prototype !== null) || !append('{')) return false
      const keys = Reflect.ownKeys(candidate)
      if (keys.some((key) => typeof key !== 'string')) return false
      const stringKeys = (keys as string[]).sort(compareStrings)
      for (let index = 0; index < stringKeys.length; index++) {
        const key = stringKeys[index]
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false
        if (index > 0 && !append(',')) return false
        if (!append(JSON.stringify(key)) || !append(':') || !visit(descriptor.value, depth + 1)) {
          return false
        }
      }
      return append('}')
    } catch {
      return false
    } finally {
      ancestors.delete(candidate)
    }
  }

  return visit(value, 0) ? hash.digest('hex') : undefined
}
