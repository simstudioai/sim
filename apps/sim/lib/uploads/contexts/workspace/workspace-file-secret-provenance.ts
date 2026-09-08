import { db } from '@sim/db'
import {
  type StoredWorkspaceFileSecretProvenanceEntry,
  type WorkspaceFileSecretProvenanceEntry,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { and, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import { encryptSecret } from '@/lib/core/security/encryption'
import type { DbTransaction } from '@/lib/db/types'
import {
  importDurableSecretProvenance,
  isPrivateSecretProvenanceScopeCompatible,
} from '@/lib/execution/durable-secret-provenance'
import {
  isDurableSecretProvenanceEnforced,
  reportDurableSecretProvenanceRefusal,
  reportDurableSecretProvenanceWrite,
  reportUnrecordedDurableProvenance,
} from '@/lib/execution/durable-secret-provenance-enforcement'
import {
  PROVENANCE_MAX_ENTRIES,
  PROVENANCE_MAX_SERIALIZED_BYTES,
} from '@/lib/execution/provenance-limits'
import {
  isResolvedSecretProvenanceAbsence,
  type ResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

/** Ids per statement. Bounds the query, never how many files a caller may classify. */
const FILE_PROVENANCE_QUERY_CHUNK_SIZE = 1_000
const ANONYMOUS_WORKSPACE_FILE_SECRET_STORAGE_NAME = 'MOUNTED_FILE_SECRET'
const LEGACY_ANONYMOUS_WORKSPACE_FILE_SECRET_STORAGE_NAME =
  ':SIM_INTERNAL_ANONYMOUS_SECRET_PROVENANCE_V1:'
export const MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE =
  'File cannot be sent to a model because its secret provenance is unavailable'

/**
 * What can be said about the secrets a file's bytes carry.
 *
 * The sidecar's `status` column stores all three values, and reader and storage still mean
 * different things by two of them. Stored `'unrecorded'` is the writer saying nobody vouched for
 * these bytes; stored `'unknown'` is a writer that knew secrets were in scope and could not map
 * them. This union records what a *reader* can conclude, so a missing row, moved version, or stale
 * or malformed sidecar also lands on `'unknown'` — "the writer refused" and "there is nothing
 * usable to read" share a conclusion but not a stored value. Only `'unrecorded'` is an absence a
 * policy may relax; it is the name the shared vocabulary already uses
 * (`reportUnrecordedDurableProvenance`, the `secret_provenance.unrecorded` audit action).
 */
export type WorkspaceFileSecretProvenance =
  | { status: 'exact'; entries: readonly WorkspaceFileSecretProvenanceEntry[] }
  /** Nothing can be said: the row is gone, the version moved, or the sidecar is stale or malformed. */
  | { status: 'unknown' }
  /** A current sidecar recording that nobody vouched for these bytes — an absence, not a fault. */
  | { status: 'unrecorded' }

export const EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE = Object.freeze({
  status: 'exact' as const,
  entries: Object.freeze([]),
})

export type WorkspaceFileSecretProvenancePolicy =
  | { mode: 'replace'; provenance: WorkspaceFileSecretProvenance }
  | { mode: 'preserve' }

export type WorkspaceFileSecretProvenanceWriteDecision =
  | { safe: true; provenance: WorkspaceFileSecretProvenance }
  | { safe: false }

export interface WorkspaceFileSecretProvenanceRepresentation {
  sourceProvenance: ResolvedSecretTraceProvenanceV1
  persistedValue: string
}

interface WorkspaceFileAttachmentIdentity {
  id?: unknown
  key?: unknown
}

export interface WorkspaceFileSecretProvenanceIdentity {
  fileId: string
  key: string
  context: 'workspace' | 'mothership'
  contentUpdatedAt?: Date
}

interface WorkspaceFileSecretProvenanceCopySource {
  fileId: string
  key: string
  contentUpdatedAtMs: number
}

interface WorkspaceFileSecretProvenanceMetadataIdentity {
  id: string
  key: string
  context: string
  contentUpdatedAt: Date
  secretProvenanceVersion: number | null
}

export interface WorkspaceFileSecretProvenanceEnvelope<T> {
  value: T
  file?: WorkspaceFileSecretProvenanceIdentity
  contributingFiles?: readonly WorkspaceFileSecretProvenanceIdentity[]
  view?: 'complete' | 'derived'
}

interface ModelSafeWorkspaceFileRow {
  key: string
  workspaceId: string | null
  context: string
  fileContentUpdatedAt: Date
  secretProvenanceVersion: number | null
  provenanceContentUpdatedAt: Date | null
  status: string | null
  entries: unknown
}

/**
 * Combines byte-contributing classifications without broadening any source.
 *
 * An absence stays unrecorded only when no contributor carries known secrets. Mixing it with
 * known secret entries cannot preserve an exact classification or discard those entries into a
 * permissive absence; the newly combined bytes must remain unknown.
 */
export function mergeWorkspaceFileSecretProvenance(
  ...provenances: readonly WorkspaceFileSecretProvenance[]
): WorkspaceFileSecretProvenance {
  if (provenances.some((provenance) => provenance.status === 'unknown')) {
    return { status: 'unknown' }
  }
  if (provenances.some((provenance) => provenance.status === 'unrecorded')) {
    return provenances.some(
      (provenance) => provenance.status === 'exact' && provenance.entries.length > 0
    )
      ? { status: 'unknown' }
      : { status: 'unrecorded' }
  }

  return {
    status: 'exact',
    entries: provenances.flatMap((provenance) =>
      provenance.status === 'exact' ? provenance.entries : []
    ),
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function exactEntryByteSize(entry: WorkspaceFileSecretProvenanceEntry): number {
  return (
    Buffer.byteLength(entry.sourceUserId, 'utf8') +
    Buffer.byteLength(entry.sourceWorkspaceId ?? '', 'utf8') +
    Buffer.byteLength(entry.name ?? '', 'utf8') +
    Buffer.byteLength(entry.encryptedValue, 'utf8')
  )
}

function isAnonymousStoredEntry(entry: StoredWorkspaceFileSecretProvenanceEntry): boolean {
  return (
    entry.anonymous === true || entry.name === LEGACY_ANONYMOUS_WORKSPACE_FILE_SECRET_STORAGE_NAME
  )
}

function storedEntryLogicalByteSize(entry: StoredWorkspaceFileSecretProvenanceEntry): number {
  return exactEntryByteSize({
    encryptedValue: entry.encryptedValue,
    sourceUserId: entry.sourceUserId,
    ...(isAnonymousStoredEntry(entry) ? {} : { name: entry.name }),
    ...(entry.sourceWorkspaceId ? { sourceWorkspaceId: entry.sourceWorkspaceId } : {}),
  })
}

function normalizeExactEntries(
  entries: readonly WorkspaceFileSecretProvenanceEntry[]
): WorkspaceFileSecretProvenanceEntry[] {
  if (entries.length > PROVENANCE_MAX_ENTRIES) {
    throw new Error('Workspace file secret provenance exceeds its entry limit')
  }

  const normalized = new Map<string, WorkspaceFileSecretProvenanceEntry>()
  let bytes = 0
  for (const entry of entries) {
    if (
      !entry.encryptedValue ||
      !entry.sourceUserId ||
      (entry.name !== undefined && entry.name.length === 0)
    ) {
      throw new Error('Workspace file secret provenance contains an invalid entry')
    }
    const key = `${entry.sourceUserId}\u0000${entry.sourceWorkspaceId ?? ''}\u0000${entry.name ?? ''}\u0000${entry.encryptedValue}`
    if (normalized.has(key)) continue
    bytes += exactEntryByteSize(entry)
    if (bytes > PROVENANCE_MAX_SERIALIZED_BYTES) {
      throw new Error('Workspace file secret provenance exceeds its size limit')
    }
    normalized.set(key, {
      encryptedValue: entry.encryptedValue,
      sourceUserId: entry.sourceUserId,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.sourceWorkspaceId ? { sourceWorkspaceId: entry.sourceWorkspaceId } : {}),
    })
  }

  return [...normalized.values()].sort(
    (left, right) =>
      compareStrings(left.sourceUserId, right.sourceUserId) ||
      compareStrings(left.sourceWorkspaceId ?? '', right.sourceWorkspaceId ?? '') ||
      compareStrings(left.name ?? '', right.name ?? '') ||
      compareStrings(left.encryptedValue, right.encryptedValue)
  )
}

function serializeExactEntriesForStorage(
  entries: readonly WorkspaceFileSecretProvenanceEntry[]
): StoredWorkspaceFileSecretProvenanceEntry[] {
  return normalizeExactEntries(entries).map(
    (entry): StoredWorkspaceFileSecretProvenanceEntry =>
      entry.name
        ? { ...entry, name: entry.name }
        : {
            ...entry,
            name: ANONYMOUS_WORKSPACE_FILE_SECRET_STORAGE_NAME,
            anonymous: true,
          }
  )
}

function deserializeExactEntriesFromStorage(
  entries: readonly StoredWorkspaceFileSecretProvenanceEntry[]
): WorkspaceFileSecretProvenanceEntry[] {
  return entries.map((entry) => ({
    encryptedValue: entry.encryptedValue,
    sourceUserId: entry.sourceUserId,
    ...(isAnonymousStoredEntry(entry) ? {} : { name: entry.name }),
    ...(entry.sourceWorkspaceId ? { sourceWorkspaceId: entry.sourceWorkspaceId } : {}),
  }))
}

/** Captures committed provenance for the exact bytes produced inside one workspace execution. */
export async function createWorkspaceFileSecretProvenanceFromRegistry(
  registry: ResolvedSecretTraceRegistry | undefined,
  persistedValue: unknown,
  destinationScope: { userId: string; workspaceId: string },
  sourceValue: unknown = persistedValue,
  representations: readonly WorkspaceFileSecretProvenanceRepresentation[] = [],
  representationsComplete = true
): Promise<WorkspaceFileSecretProvenanceWriteDecision> {
  /**
   * No registry means no recorder ran, so nothing was written down about these bytes. That is an
   * absence, and it is the one thing this surface's policy may relax — distinct from the taint
   * every `safe: false` below produces, which a caller persists as `unknown` and no policy relaxes.
   */
  if (!registry) return { safe: true, provenance: { status: 'unrecorded' } }
  const sourceProvenance = registry.exportCommittedProvenanceForValue(sourceValue)
  const persistedProvenance = Object.is(sourceValue, persistedValue)
    ? sourceProvenance
    : registry.exportCommittedProvenanceForValue(persistedValue)
  if (!sourceProvenance.complete || !persistedProvenance.complete) {
    /**
     * A latched registry is the same absence only when both hold: nothing activated, and every
     * recorded reason is in the registry's absence set — reasons meaning provenance was never on
     * offer and no secret material transited the latching context. Zero active entries alone does
     * not prove that: a decrypt, verification, or filtering failure trips while plaintext is in
     * flight, before anything activates, so any such reason keeps the taint. What remains is a
     * registry that latched with nothing to lose (a failed workflow run crossing with no envelope
     * is the recurring producer), which is exactly what `unrecorded` states. Stamping taint for
     * that state made one failed run turn every file its chat later wrote into a hard refusal
     * until the next clean write.
     */
    const diagnostics = registry.getIncompletenessDiagnostics()
    if (
      diagnostics?.activeEntryCount === 0 &&
      diagnostics.reasons.length > 0 &&
      diagnostics.reasons.every(isResolvedSecretProvenanceAbsence)
    ) {
      return { safe: true, provenance: { status: 'unrecorded' } }
    }
    return { safe: false }
  }
  if (
    (sourceProvenance.entries.length > 0 &&
      !isPrivateSecretProvenanceScopeCompatible(sourceProvenance.scope, destinationScope)) ||
    (persistedProvenance.entries.length > 0 &&
      !isPrivateSecretProvenanceScopeCompatible(persistedProvenance.scope, destinationScope))
  ) {
    return { safe: false }
  }
  if (!representationsComplete) {
    return { safe: false }
  }

  const provenanceEntryKey = (entry: { name?: string; encryptedValue: string }): string =>
    `${entry.name ?? ''}\u0000${entry.encryptedValue}`
  const sourceEntryKeys = new Set(sourceProvenance.entries.map(provenanceEntryKey))
  const persistedEntryKeys = new Set(persistedProvenance.entries.map(provenanceEntryKey))
  const representedSourceEntryKeys = new Set(persistedEntryKeys)
  const derivedRepresentations = new Map<string, { name?: string; persistedValue: string }>()
  for (const representation of representations) {
    if (!representation.sourceProvenance.complete) return { safe: false }
    if (
      representation.sourceProvenance.entries.length > 0 &&
      !isPrivateSecretProvenanceScopeCompatible(
        representation.sourceProvenance.scope,
        destinationScope
      )
    ) {
      return { safe: false }
    }
    for (const entry of representation.sourceProvenance.entries) {
      const sourceEntryKey = provenanceEntryKey(entry)
      if (!sourceEntryKeys.has(sourceEntryKey)) return { safe: false }
      representedSourceEntryKeys.add(sourceEntryKey)
      if (persistedEntryKeys.has(sourceEntryKey)) continue
      if (representation.persistedValue.length === 0) {
        return { safe: false }
      }
      derivedRepresentations.set(`${entry.name ?? ''}\u0000${representation.persistedValue}`, {
        ...(entry.name ? { name: entry.name } : {}),
        persistedValue: representation.persistedValue,
      })
    }
  }
  if (
    sourceProvenance.entries.some(
      (entry) => !representedSourceEntryKeys.has(provenanceEntryKey(entry))
    )
  ) {
    return { safe: false }
  }
  if (persistedProvenance.entries.length === 0 && derivedRepresentations.size === 0) {
    return { safe: true, provenance: EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE }
  }
  const sourceScope = sourceProvenance.scope
  if (!sourceScope) return { safe: false }

  const entries: WorkspaceFileSecretProvenanceEntry[] = []
  for (const entry of sourceProvenance.entries) {
    entries.push({
      encryptedValue: entry.encryptedValue,
      sourceUserId: sourceScope.userId,
      ...(entry.name ? { name: entry.name } : {}),
      ...(sourceScope.workspaceId ? { sourceWorkspaceId: sourceScope.workspaceId } : {}),
    })
  }
  if (entries.length + derivedRepresentations.size > PROVENANCE_MAX_ENTRIES) {
    return { safe: false }
  }
  try {
    for (const representation of derivedRepresentations.values()) {
      const { encrypted } = await encryptSecret(representation.persistedValue)
      entries.push({
        encryptedValue: encrypted,
        sourceUserId: sourceScope.userId,
        ...(representation.name ? { name: representation.name } : {}),
        ...(sourceScope.workspaceId ? { sourceWorkspaceId: sourceScope.workspaceId } : {}),
      })
    }
  } catch {
    return { safe: false }
  }
  try {
    return {
      safe: true,
      provenance: {
        status: 'exact',
        entries: normalizeExactEntries(entries),
      },
    }
  } catch {
    return { safe: false }
  }
}

function isValidStoredEntries(value: unknown): value is StoredWorkspaceFileSecretProvenanceEntry[] {
  if (!Array.isArray(value) || value.length > PROVENANCE_MAX_ENTRIES) {
    return false
  }
  let bytes = 0
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>).name !== 'string' ||
      !(entry as Record<string, unknown>).name ||
      ((entry as Record<string, unknown>).anonymous !== undefined &&
        (entry as Record<string, unknown>).anonymous !== true) ||
      ((entry as Record<string, unknown>).anonymous === true &&
        (entry as Record<string, unknown>).name !== ANONYMOUS_WORKSPACE_FILE_SECRET_STORAGE_NAME &&
        (entry as Record<string, unknown>).name !==
          LEGACY_ANONYMOUS_WORKSPACE_FILE_SECRET_STORAGE_NAME) ||
      typeof (entry as Record<string, unknown>).encryptedValue !== 'string' ||
      !(entry as Record<string, unknown>).encryptedValue ||
      typeof (entry as Record<string, unknown>).sourceUserId !== 'string' ||
      !(entry as Record<string, unknown>).sourceUserId ||
      ((entry as Record<string, unknown>).sourceWorkspaceId !== undefined &&
        typeof (entry as Record<string, unknown>).sourceWorkspaceId !== 'string')
    ) {
      return false
    }
    bytes += storedEntryLogicalByteSize(entry as StoredWorkspaceFileSecretProvenanceEntry)
    if (bytes > PROVENANCE_MAX_SERIALIZED_BYTES) return false
  }
  return true
}

async function markWorkspaceFileSecretProvenanceTrackedInTx(
  tx: DbTransaction,
  fileId: string,
  contentUpdatedAt: Date
): Promise<void> {
  const nextContentMillisecond = new Date(contentUpdatedAt.getTime() + 1)
  const [tracked] = await tx
    .update(workspaceFiles)
    .set({ secretProvenanceVersion: 1 })
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        gte(workspaceFiles.contentUpdatedAt, contentUpdatedAt),
        lt(workspaceFiles.contentUpdatedAt, nextContentMillisecond),
        inArray(workspaceFiles.context, ['workspace', 'mothership']),
        or(
          isNull(workspaceFiles.secretProvenanceVersion),
          eq(workspaceFiles.secretProvenanceVersion, 1)
        )
      )
    )
    .returning({ id: workspaceFiles.id })
  if (!tracked) {
    throw new Error('Workspace file provenance could not bind the tracked content version')
  }
}

/** Atomically replaces the private provenance associated with the file's current bytes. */
export async function replaceWorkspaceFileSecretProvenanceInTx(
  tx: DbTransaction,
  fileId: string,
  contentUpdatedAt: Date,
  provenance: WorkspaceFileSecretProvenance
): Promise<void> {
  if (provenance.status === 'exact') {
    const entries = serializeExactEntriesForStorage(provenance.entries)
    await tx
      .insert(workspaceFileSecretProvenance)
      .values({ fileId, contentUpdatedAt, status: 'exact', entries, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: workspaceFileSecretProvenance.fileId,
        set: { contentUpdatedAt, status: 'exact', entries, updatedAt: new Date() },
      })
    await markWorkspaceFileSecretProvenanceTrackedInTx(tx, fileId, contentUpdatedAt)
    return
  }

  /**
   * Absence and taint are different claims and must not share a stored value. Collapsing them here
   * is what let a file the writer deliberately refused — a child of a secret-bearing archive, a
   * generated asset whose safety decision was `false` — become indistinguishable from one nobody
   * recorded, and therefore eligible for the same relaxation.
   */
  const status = provenance.status === 'unrecorded' ? 'unrecorded' : 'unknown'
  await tx
    .insert(workspaceFileSecretProvenance)
    .values({ fileId, contentUpdatedAt, status, entries: [], updatedAt: new Date() })
    .onConflictDoUpdate({
      target: workspaceFileSecretProvenance.fileId,
      set: { contentUpdatedAt, status, entries: [], updatedAt: new Date() },
    })
  await markWorkspaceFileSecretProvenanceTrackedInTx(tx, fileId, contentUpdatedAt)
  reportDurableSecretProvenanceWrite({
    surface: 'workspace-file',
    status,
    cause:
      status === 'unknown' ? 'workspace-file-write-unknown' : 'workspace-file-write-unrecorded',
    resourceId: fileId,
  })
}

/**
 * Initializes provenance for an exact file version without replacing an existing classification.
 */
export async function initializeWorkspaceFileSecretProvenanceInTx(
  tx: DbTransaction,
  fileId: string,
  contentUpdatedAt: Date,
  provenance: WorkspaceFileSecretProvenance
): Promise<void> {
  const isExact = provenance.status === 'exact'
  const entries = isExact ? serializeExactEntriesForStorage(provenance.entries) : []
  const status = isExact ? 'exact' : provenance.status === 'unrecorded' ? 'unrecorded' : 'unknown'
  const inserted = await tx
    .insert(workspaceFileSecretProvenance)
    .values({
      fileId,
      contentUpdatedAt,
      status,
      entries,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ fileId: workspaceFileSecretProvenance.fileId })
  await markWorkspaceFileSecretProvenanceTrackedInTx(tx, fileId, contentUpdatedAt)
  if (status !== 'exact' && inserted.length > 0) {
    reportDurableSecretProvenanceWrite({
      surface: 'workspace-file',
      status,
      cause:
        status === 'unknown' ? 'workspace-file-write-unknown' : 'workspace-file-write-unrecorded',
      resourceId: fileId,
    })
  }
}

/** Advances an intentionally preserved classification to the file's new content version. */
export async function preserveWorkspaceFileSecretProvenanceInTx(
  tx: DbTransaction,
  fileId: string,
  previousContentUpdatedAt: Date,
  previousSecretProvenanceVersion: number | null,
  nextContentUpdatedAt: Date
): Promise<void> {
  if (previousSecretProvenanceVersion === null) return
  const [stored] = await tx
    .select({ contentUpdatedAt: workspaceFileSecretProvenance.contentUpdatedAt })
    .from(workspaceFileSecretProvenance)
    .where(eq(workspaceFileSecretProvenance.fileId, fileId))
    .limit(1)
  if (!stored) {
    if (previousSecretProvenanceVersion === null) return
    await replaceWorkspaceFileSecretProvenanceInTx(tx, fileId, nextContentUpdatedAt, {
      status: 'unknown',
    })
    return
  }
  if (stored.contentUpdatedAt.getTime() !== previousContentUpdatedAt.getTime()) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, fileId, nextContentUpdatedAt, {
      status: 'unknown',
    })
    return
  }

  const [preserved] = await tx
    .update(workspaceFileSecretProvenance)
    .set({ contentUpdatedAt: nextContentUpdatedAt, updatedAt: new Date() })
    .where(
      and(
        eq(workspaceFileSecretProvenance.fileId, fileId),
        eq(workspaceFileSecretProvenance.contentUpdatedAt, previousContentUpdatedAt)
      )
    )
    .returning({ fileId: workspaceFileSecretProvenance.fileId })
  if (!preserved) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, fileId, nextContentUpdatedAt, {
      status: 'unknown',
    })
    return
  }
  await markWorkspaceFileSecretProvenanceTrackedInTx(tx, fileId, nextContentUpdatedAt)
}

/** Copies exact provenance for a byte-identical, same-owner-scope file copy; otherwise unknown. */
export async function copyWorkspaceFileSecretProvenanceInTx(
  tx: DbTransaction,
  expectedSource: WorkspaceFileSecretProvenanceCopySource | undefined,
  targetFileId: string
): Promise<void> {
  const [target] = await tx
    .select({
      userId: workspaceFiles.userId,
      workspaceId: workspaceFiles.workspaceId,
      contentUpdatedAt: workspaceFiles.contentUpdatedAt,
    })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.id, targetFileId))
    .limit(1)

  if (!target) {
    throw new Error('Workspace file provenance copy could not bind the target file version')
  }
  if (!expectedSource) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
      status: 'unknown',
    })
    return
  }

  const [source] = await tx
    .select({
      key: workspaceFiles.key,
      userId: workspaceFiles.userId,
      workspaceId: workspaceFiles.workspaceId,
      secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
      fileContentUpdatedAt: workspaceFiles.contentUpdatedAt,
      provenanceContentUpdatedAt: workspaceFileSecretProvenance.contentUpdatedAt,
      status: workspaceFileSecretProvenance.status,
      entries: workspaceFileSecretProvenance.entries,
    })
    .from(workspaceFiles)
    .leftJoin(
      workspaceFileSecretProvenance,
      eq(workspaceFileSecretProvenance.fileId, workspaceFiles.id)
    )
    .where(eq(workspaceFiles.id, expectedSource.fileId))
    .limit(1)
  if (
    !source ||
    source.key !== expectedSource.key ||
    source.fileContentUpdatedAt.getTime() !== expectedSource.contentUpdatedAtMs
  ) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
      status: 'unknown',
    })
    return
  }
  if (source.secretProvenanceVersion === null) return
  if (source.secretProvenanceVersion !== 1) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
      status: 'unknown',
    })
    return
  }
  if (
    source.provenanceContentUpdatedAt?.getTime() !== source.fileContentUpdatedAt.getTime() ||
    !isValidStoredEntries(source.entries)
  ) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
      status: 'unknown',
    })
    return
  }
  /**
   * An absence copies as an absence. Folding it in with the refusals below would hand the target a
   * taint the source never carried, and a fork or a chat copy would turn a readable file into a
   * permanently refused one — the pathology this surface exists to undo, reached by copying.
   *
   * Safe to carry across the scope checks below, which exist to stop one workspace's secret entries
   * landing in another's file. A recorded absence has no entries to carry.
   */
  if (source.status === 'unrecorded') {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
      status: 'unrecorded',
    })
    return
  }
  if (
    source.status !== 'exact' ||
    (source.entries.length > 0 &&
      (!source.workspaceId ||
        !target.workspaceId ||
        source.userId !== target.userId ||
        source.workspaceId !== target.workspaceId))
  ) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
      status: 'unknown',
    })
    return
  }
  await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
    status: 'exact',
    entries: deserializeExactEntriesFromStorage(source.entries),
  })
}

/** Marks legacy Function exports unknown, constrained to canonical rows in the caller's workspace. */
export async function markWorkspaceFileSecretProvenanceUnknown(
  workspaceId: string,
  fileIds: readonly string[]
): Promise<void> {
  const uniqueIds = [...new Set(fileIds.filter((fileId) => fileId.length > 0))]
  if (uniqueIds.length === 0) return

  await db.transaction(async (tx) => {
    /**
     * Paged rather than capped. This marks files unknown, so refusing to run because there were
     * too many would leave every one of them carrying whatever provenance it had before — the
     * failure this function exists to prevent, reached by declining to prevent it. The former
     * twenty-file limit threw, which made an ordinary Function block that wrote twenty-one files
     * fail outright. The page size bounds the statement, never the caller.
     */
    let bound = 0
    for (let index = 0; index < uniqueIds.length; index += FILE_PROVENANCE_QUERY_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(index, index + FILE_PROVENANCE_QUERY_CHUNK_SIZE)
      const rows = await tx
        .select({ id: workspaceFiles.id, contentUpdatedAt: workspaceFiles.contentUpdatedAt })
        .from(workspaceFiles)
        .where(
          and(
            inArray(workspaceFiles.id, chunk),
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'workspace'),
            isNull(workspaceFiles.deletedAt)
          )
        )
      bound += rows.length
      for (const row of rows) {
        await replaceWorkspaceFileSecretProvenanceInTx(tx, row.id, row.contentUpdatedAt, {
          status: 'unknown',
        })
      }
    }
    /**
     * Still fatal, and deliberately so: an id that matched no canonical row means the caller named
     * a file this workspace does not own, which is not a capacity problem.
     */
    if (bound !== uniqueIds.length) {
      throw new Error('Function export file provenance could not be bound to canonical records')
    }
  })
}

/** Reads provenance only when it still belongs to this exact canonical file id and storage key. */
export async function getBoundWorkspaceFileSecretProvenance(
  workspaceId: string,
  identity: WorkspaceFileSecretProvenanceIdentity
): Promise<WorkspaceFileSecretProvenance> {
  const [row] = await db
    .select({
      fileContentUpdatedAt: workspaceFiles.contentUpdatedAt,
      secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
      provenanceContentUpdatedAt: workspaceFileSecretProvenance.contentUpdatedAt,
      status: workspaceFileSecretProvenance.status,
      entries: workspaceFileSecretProvenance.entries,
    })
    .from(workspaceFiles)
    .leftJoin(
      workspaceFileSecretProvenance,
      eq(workspaceFileSecretProvenance.fileId, workspaceFiles.id)
    )
    .where(
      and(
        eq(workspaceFiles.id, identity.fileId),
        eq(workspaceFiles.key, identity.key),
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, identity.context)
        // Deliberately no deletedAt filter: `id` alone pins the exact row, and
        // recently-deleted/ reads are a real surface — excluding soft-deleted
        // rows made every archived file read as provenance-unknown and refused.
      )
    )
    .limit(1)

  if (!row) return { status: 'unknown' }
  /**
   * A version mismatch is not an absence: the caller is asking about content this file no longer
   * holds, so nothing can be said about it and no policy relaxes that.
   */
  if (
    identity.contentUpdatedAt &&
    identity.contentUpdatedAt.getTime() !== row.fileContentUpdatedAt.getTime()
  ) {
    return { status: 'unknown' }
  }
  if (row.secretProvenanceVersion === null) return EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE
  if (row.secretProvenanceVersion !== 1) return { status: 'unknown' }
  const bindingIsCurrent =
    row.provenanceContentUpdatedAt?.getTime() === row.fileContentUpdatedAt.getTime()
  if (!bindingIsCurrent || !isValidStoredEntries(row.entries)) return { status: 'unknown' }
  /**
   * The one shape the surface's policy may relax: a sidecar bound to this exact content recording
   * that nobody vouched for it — the same statement the untracked file above makes. A stored
   * `unknown` is the opposite claim, written by a writer that refused these bytes on purpose, and
   * stays refused.
   */
  if (row.status === 'unrecorded') return { status: 'unrecorded' }
  if (row.status !== 'exact') return { status: 'unknown' }
  return { status: 'exact', entries: deserializeExactEntriesFromStorage(row.entries) }
}

/** Batch-loads classifications already bound to exact, authorized file metadata snapshots. */
export async function getBoundWorkspaceFileSecretProvenanceByMetadata(
  executor: Pick<typeof db, 'select'>,
  metadata: readonly WorkspaceFileSecretProvenanceMetadataIdentity[]
): Promise<Map<string, WorkspaceFileSecretProvenance>> {
  const byId = new Map(metadata.map((record) => [record.id, record]))
  const result = new Map<string, WorkspaceFileSecretProvenance>()
  const ids = [...byId.keys()]
  for (let index = 0; index < ids.length; index += 1_000) {
    const rows = await executor
      .select({
        id: workspaceFiles.id,
        key: workspaceFiles.key,
        context: workspaceFiles.context,
        fileContentUpdatedAt: workspaceFiles.contentUpdatedAt,
        secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
        provenanceContentUpdatedAt: workspaceFileSecretProvenance.contentUpdatedAt,
        status: workspaceFileSecretProvenance.status,
        entries: workspaceFileSecretProvenance.entries,
      })
      .from(workspaceFiles)
      .leftJoin(
        workspaceFileSecretProvenance,
        eq(workspaceFileSecretProvenance.fileId, workspaceFiles.id)
      )
      .where(inArray(workspaceFiles.id, ids.slice(index, index + 1_000)))
    for (const row of rows) {
      const expected = byId.get(row.id)
      if (
        !expected ||
        row.key !== expected.key ||
        row.context !== expected.context ||
        row.fileContentUpdatedAt.getTime() !== expected.contentUpdatedAt.getTime() ||
        row.secretProvenanceVersion !== expected.secretProvenanceVersion
      ) {
        result.set(row.id, { status: 'unknown' })
        continue
      }
      if (row.secretProvenanceVersion === null) {
        result.set(row.id, EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE)
        continue
      }
      if (
        row.secretProvenanceVersion !== 1 ||
        row.provenanceContentUpdatedAt?.getTime() !== row.fileContentUpdatedAt.getTime() ||
        !isValidStoredEntries(row.entries)
      ) {
        result.set(row.id, { status: 'unknown' })
        continue
      }
      /**
       * Same answer the single-file reader gives the same row. Collapsing a recorded absence into
       * `unknown` here would leave two classifiers describing one policy differently, and the
       * caller that eventually distinguishes them would get a different verdict depending on which
       * one it happened to call.
       */
      if (row.status === 'unrecorded') {
        result.set(row.id, { status: 'unrecorded' })
        continue
      }
      if (row.status !== 'exact') {
        result.set(row.id, { status: 'unknown' })
        continue
      }
      result.set(row.id, {
        status: 'exact',
        entries: deserializeExactEntriesFromStorage(row.entries),
      })
    }
  }
  for (const id of ids) {
    if (!result.has(id)) result.set(id, { status: 'unknown' })
  }
  return result
}

/**
 * Whether a file nobody could vouch for may still be read.
 *
 * A file that was never tracked already returns exact-empty a branch earlier, and it makes exactly
 * the same statement as this one: nobody recorded which secrets these bytes carry. Refusing only
 * the second left a writer that momentarily could not vouch permanently worse off than one that
 * never tried, with no way back — nothing rewrites a file's provenance but another content write,
 * so the file simply stopped working, everywhere, for good.
 *
 * So it reads, and the workspace is told. Deliberately narrower than "not exact": a stale binding
 * describes content that has since changed and a malformed sidecar is a fault, and neither is the
 * absence this covers. Closing the surface again is a matter of naming it in
 * `DURABLE_SECRET_PROVENANCE_ENFORCED_SURFACES`.
 */
function mayReadUnrecordedWorkspaceFile(
  workspaceId: string | undefined,
  count = 1,
  actorUserId?: string
): boolean {
  if (isDurableSecretProvenanceEnforced('workspace-file')) {
    reportDurableSecretProvenanceRefusal({
      surface: 'workspace-file',
      cause: 'workspace-file-unrecorded-enforced',
      workspaceId,
    })
    return false
  }
  if (count > 0) {
    reportUnrecordedDurableProvenance({
      surface: 'workspace-file',
      cause: 'durable-provenance-unknown',
      ...(count > 1 ? { affectedCount: count } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      actorUserId: actorUserId ?? null,
    })
  }
  return true
}

/** Reports the canonical file identity without exposing its storage key or contents. */
function refuseWorkspaceFileProvenance(
  cause:
    | 'workspace-file-provenance-unavailable'
    | 'workspace-file-opaque-secret-content'
    | 'workspace-file-registry-unavailable',
  workspaceId: string | undefined,
  resourceId?: string
): false {
  reportDurableSecretProvenanceRefusal({
    surface: 'workspace-file',
    cause,
    workspaceId,
    resourceId,
  })
  return false
}

/**
 * Authorizes one model-facing view of an exact workspace-file version. Complete text views import
 * the entire sidecar so representation-changing consumers retain the original lineage. Derived
 * text views import only entries present in the returned value; opaque bytes cannot be inspected
 * and therefore require an exact-empty sidecar.
 */
export async function importWorkspaceFileSecretProvenanceForModelView(args: {
  workspaceId: string
  identity: WorkspaceFileSecretProvenanceIdentity
  registry?: ResolvedSecretTraceRegistry
  view: 'complete' | 'derived' | 'opaque'
  value?: unknown
  /** Whose access authorized the read, for the unrecorded-read audit entry; null when unnameable. */
  actorUserId?: string
}): Promise<boolean> {
  const provenance = await getBoundWorkspaceFileSecretProvenance(args.workspaceId, args.identity)
  if (provenance.status === 'unknown') {
    return refuseWorkspaceFileProvenance(
      'workspace-file-provenance-unavailable',
      args.workspaceId,
      args.identity.fileId
    )
  }
  if (provenance.status === 'unrecorded') {
    return mayReadUnrecordedWorkspaceFile(args.workspaceId, 1, args.actorUserId)
  }
  if (provenance.entries.length === 0) return true
  if (args.view === 'opaque' || !args.registry) {
    return refuseWorkspaceFileProvenance(
      args.view === 'opaque'
        ? 'workspace-file-opaque-secret-content'
        : 'workspace-file-registry-unavailable',
      args.workspaceId,
      args.identity.fileId
    )
  }

  if (args.view === 'derived' && args.value === undefined) {
    return refuseWorkspaceFileProvenance(
      'workspace-file-provenance-unavailable',
      args.workspaceId,
      args.identity.fileId
    )
  }

  return importDurableSecretProvenance(
    args.registry,
    provenance,
    args.view === 'derived' ? args.value : undefined
  )
}

/** Allows opaque bytes to leave private storage only when their exact sidecar is provably empty. */
export async function isOpaqueWorkspaceFileEgressSafe(
  workspaceId: string,
  identity: WorkspaceFileSecretProvenanceIdentity
): Promise<boolean> {
  const provenance = await getBoundWorkspaceFileSecretProvenance(workspaceId, identity)
  if (provenance.status === 'unknown') {
    return refuseWorkspaceFileProvenance(
      'workspace-file-provenance-unavailable',
      workspaceId,
      identity.fileId
    )
  }
  if (provenance.status === 'unrecorded') return mayReadUnrecordedWorkspaceFile(workspaceId)
  return (
    provenance.entries.length === 0 ||
    refuseWorkspaceFileProvenance(
      'workspace-file-opaque-secret-content',
      workspaceId,
      identity.fileId
    )
  )
}

/**
 * Activates all provenance bound to an exact persisted byte sequence entering a trusted runtime.
 * This is intentionally broader than the model-value helper above: arbitrary code may read any
 * mounted byte, so its result boundary must know every secret the mounted file can contribute.
 */
export async function importWorkspaceFileSecretProvenanceForRuntime(args: {
  workspaceId: string
  identity: WorkspaceFileSecretProvenanceIdentity
  registry?: ResolvedSecretTraceRegistry
  /** Whose access authorized the read, for the unrecorded-read audit entry; null when unnameable. */
  actorUserId?: string
}): Promise<boolean> {
  const provenance = await getBoundWorkspaceFileSecretProvenance(args.workspaceId, args.identity)
  if (provenance.status === 'unknown') {
    return refuseWorkspaceFileProvenance(
      'workspace-file-provenance-unavailable',
      args.workspaceId,
      args.identity.fileId
    )
  }
  if (provenance.status === 'unrecorded') {
    return mayReadUnrecordedWorkspaceFile(args.workspaceId, 1, args.actorUserId)
  }
  if (provenance.entries.length === 0) return true
  if (!args.registry) {
    return refuseWorkspaceFileProvenance(
      'workspace-file-registry-unavailable',
      args.workspaceId,
      args.identity.fileId
    )
  }

  const imported = await importDurableSecretProvenance(args.registry, provenance)
  return imported && !args.registry.isPermanentlyIncomplete()
}

/**
 * Removes model attachments whose canonical workspace-file record is tainted or unknown.
 * Missing legacy records remain compatible; persisted records are classified by their unique
 * active storage-key binding and private provenance row. Attachment ids are deliberately ignored:
 * older persisted workflows omit them and file normalization may synthesize a runtime-only id.
 * This classification is not file authorization; callers still enforce storage access before
 * reading bytes or issuing a provider URL.
 */
export async function filterModelSafeWorkspaceFileAttachments<
  TAttachment extends WorkspaceFileAttachmentIdentity,
>(
  attachments: readonly TAttachment[],
  options: { workspaceId?: string; actorUserId?: string } = {}
): Promise<TAttachment[]> {
  if (attachments.length === 0) return []
  if (attachments.length > PROVENANCE_MAX_ENTRIES) {
    throw new Error('Too many file attachments to verify secret provenance')
  }

  const keys = [
    ...new Set(
      attachments
        .map((attachment) => attachment.key)
        .filter((key): key is string => typeof key === 'string' && key.length > 0)
    ),
  ]
  if (keys.length === 0) return [...attachments]

  const rows = await loadModelSafeWorkspaceFileRows(keys)

  const rowByKey = new Map(rows.map((row) => [row.key, row]))
  let unrecorded = 0
  let refused = 0
  const kept = attachments.filter((attachment) => {
    if (typeof attachment.key !== 'string' || attachment.key.length === 0) return true
    const row = rowByKey.get(attachment.key)
    if (!row) return true
    if (row.context !== 'workspace' && row.context !== 'mothership') return true
    const classification = classifyModelSafeWorkspaceFileRow(row, options.workspaceId)
    if (classification === 'safe') return true
    if (classification === 'unsafe') {
      refused += 1
      return false
    }
    unrecorded += 1
    return !isDurableSecretProvenanceEnforced('workspace-file')
  })
  if (refused > 0) {
    refuseWorkspaceFileProvenance('workspace-file-provenance-unavailable', options.workspaceId)
  }
  /** One report for the whole set of attachments, which is one read, rather than one per file. */
  if (unrecorded > 0) {
    mayReadUnrecordedWorkspaceFile(options.workspaceId, unrecorded, options.actorUserId)
  }
  return kept
}

/**
 * Classifies one row without deciding it. `unrecorded` is kept apart from `unsafe` because only the
 * first is the same statement an untracked file makes, and only the first is the surface's policy
 * to relax — a stale binding describes content that has since changed, and a malformed sidecar is a
 * fault no policy relaxes.
 */
type ModelSafeWorkspaceFileClassification = 'safe' | 'unrecorded' | 'unsafe'

function classifyModelSafeWorkspaceFileRow(
  row: ModelSafeWorkspaceFileRow,
  workspaceId?: string
): ModelSafeWorkspaceFileClassification {
  if (workspaceId && row.workspaceId !== workspaceId) return 'unsafe'
  if (row.secretProvenanceVersion === null) return 'safe'
  if (row.secretProvenanceVersion !== 1) return 'unsafe'
  const bindingIsCurrent =
    row.provenanceContentUpdatedAt?.getTime() === row.fileContentUpdatedAt.getTime()
  if (!bindingIsCurrent || !isValidStoredEntries(row.entries)) return 'unsafe'
  if (row.status === 'unrecorded') return 'unrecorded'
  if (row.status !== 'exact') return 'unsafe'
  return row.entries.length === 0 ? 'safe' : 'unsafe'
}

async function loadModelSafeWorkspaceFileRows(
  keys: readonly string[]
): Promise<ModelSafeWorkspaceFileRow[]> {
  return db
    .select({
      key: workspaceFiles.key,
      workspaceId: workspaceFiles.workspaceId,
      context: workspaceFiles.context,
      fileContentUpdatedAt: workspaceFiles.contentUpdatedAt,
      secretProvenanceVersion: workspaceFiles.secretProvenanceVersion,
      provenanceContentUpdatedAt: workspaceFileSecretProvenance.contentUpdatedAt,
      status: workspaceFileSecretProvenance.status,
      entries: workspaceFileSecretProvenance.entries,
    })
    .from(workspaceFiles)
    .leftJoin(
      workspaceFileSecretProvenance,
      eq(workspaceFileSecretProvenance.fileId, workspaceFiles.id)
    )
    .where(and(inArray(workspaceFiles.key, [...keys]), isNull(workspaceFiles.deletedAt)))
}

/**
 * Verifies a server-authorized storage key before its bytes or signed URL cross a model boundary.
 * Unlike attachment filtering, the key has already passed access control, so no caller-provided
 * file id is required. Untouched legacy records remain compatible; tracked unknown or tainted
 * content fails closed.
 */
export async function isModelSafeWorkspaceFileKey(
  key: string,
  options: { workspaceId?: string; actorUserId?: string } = {}
): Promise<boolean> {
  return areModelSafeWorkspaceFileKeys([key], options)
}

/**
 * Batch variant for server-authorized storage keys crossing the same model boundary. Missing keys
 * and non-workspace contexts retain their legacy/raw behavior; canonical workspace and mothership
 * rows are accepted only when every current content version has exact-empty provenance.
 */
export async function areModelSafeWorkspaceFileKeys(
  keys: readonly string[],
  options: { workspaceId?: string; actorUserId?: string } = {}
): Promise<boolean> {
  const uniqueKeys = [...new Set(keys.filter((key) => key.length > 0))]
  if (uniqueKeys.length === 0) return true
  if (uniqueKeys.length > PROVENANCE_MAX_ENTRIES) {
    throw new Error('Too many file keys to verify secret provenance')
  }

  const rows = await loadModelSafeWorkspaceFileRows(uniqueKeys)

  let unrecorded = 0
  for (const row of rows) {
    if (row.context !== 'workspace' && row.context !== 'mothership') continue
    const classification = classifyModelSafeWorkspaceFileRow(row, options.workspaceId)
    if (classification === 'unsafe') {
      return refuseWorkspaceFileProvenance(
        'workspace-file-provenance-unavailable',
        options.workspaceId ?? row.workspaceId ?? undefined
      )
    }
    if (classification === 'unrecorded') unrecorded += 1
  }
  /** One report for the batch, not one per key: a caller checking many keys is one read. */
  return (
    unrecorded === 0 ||
    mayReadUnrecordedWorkspaceFile(options.workspaceId, unrecorded, options.actorUserId)
  )
}
