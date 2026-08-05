import { db } from '@sim/db'
import {
  type WorkspaceFileSecretProvenanceEntry,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export const MAX_WORKSPACE_FILE_SECRET_PROVENANCE_ENTRIES = 10_000
export const MAX_WORKSPACE_FILE_SECRET_PROVENANCE_BYTES = 8 * 1024 * 1024
const MAX_MODEL_ATTACHMENT_PROVENANCE_LOOKUPS = 1_000
const MAX_FUNCTION_EXPORT_PROVENANCE_FILES = 20

export type WorkspaceFileSecretProvenance =
  | { status: 'exact'; entries: readonly WorkspaceFileSecretProvenanceEntry[] }
  | { status: 'unknown' }

export const EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE = Object.freeze({
  status: 'exact' as const,
  entries: Object.freeze([]),
})

export type WorkspaceFileSecretProvenancePolicy =
  | { mode: 'replace'; provenance: WorkspaceFileSecretProvenance }
  | { mode: 'preserve' }

export interface WorkspaceFileAttachmentIdentity {
  id?: unknown
  key?: unknown
}

export interface WorkspaceFileSecretProvenanceIdentity {
  fileId: string
  key: string
  context: 'workspace' | 'mothership'
}

export interface WorkspaceFileSecretProvenanceCopySource {
  fileId: string
  key: string
  contentUpdatedAtMs: number
}

export interface WorkspaceFileSecretProvenanceEnvelope<T> {
  value: T
  file?: WorkspaceFileSecretProvenanceIdentity
}

/** Combines byte-contributing classifications without broadening an unknown source. */
export function mergeWorkspaceFileSecretProvenance(
  ...provenances: readonly WorkspaceFileSecretProvenance[]
): WorkspaceFileSecretProvenance {
  if (provenances.some((provenance) => provenance.status === 'unknown')) {
    return { status: 'unknown' }
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

function normalizeExactEntries(
  entries: readonly WorkspaceFileSecretProvenanceEntry[]
): WorkspaceFileSecretProvenanceEntry[] {
  if (entries.length > MAX_WORKSPACE_FILE_SECRET_PROVENANCE_ENTRIES) {
    throw new Error('Workspace file secret provenance exceeds its entry limit')
  }

  const normalized = new Map<string, WorkspaceFileSecretProvenanceEntry>()
  let bytes = 0
  for (const entry of entries) {
    if (!entry.name || !entry.encryptedValue) {
      throw new Error('Workspace file secret provenance contains an invalid entry')
    }
    const key = `${entry.name}\u0000${entry.encryptedValue}`
    if (normalized.has(key)) continue
    bytes += Buffer.byteLength(entry.name, 'utf8') + Buffer.byteLength(entry.encryptedValue, 'utf8')
    if (bytes > MAX_WORKSPACE_FILE_SECRET_PROVENANCE_BYTES) {
      throw new Error('Workspace file secret provenance exceeds its size limit')
    }
    normalized.set(key, { name: entry.name, encryptedValue: entry.encryptedValue })
  }

  return [...normalized.values()].sort(
    (left, right) =>
      compareStrings(left.name, right.name) ||
      compareStrings(left.encryptedValue, right.encryptedValue)
  )
}

function isValidStoredEntries(value: unknown): value is WorkspaceFileSecretProvenanceEntry[] {
  if (!Array.isArray(value) || value.length > MAX_WORKSPACE_FILE_SECRET_PROVENANCE_ENTRIES) {
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
      typeof (entry as Record<string, unknown>).encryptedValue !== 'string' ||
      !(entry as Record<string, unknown>).encryptedValue
    ) {
      return false
    }
    const record = entry as WorkspaceFileSecretProvenanceEntry
    bytes +=
      Buffer.byteLength(record.name, 'utf8') + Buffer.byteLength(record.encryptedValue, 'utf8')
    if (bytes > MAX_WORKSPACE_FILE_SECRET_PROVENANCE_BYTES) return false
  }
  return true
}

async function markWorkspaceFileSecretProvenanceTrackedInTx(
  tx: DbTransaction,
  fileId: string,
  contentUpdatedAt: Date
): Promise<void> {
  const [tracked] = await tx
    .update(workspaceFiles)
    .set({ secretProvenanceVersion: 1 })
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.contentUpdatedAt, contentUpdatedAt),
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
    const entries = normalizeExactEntries(provenance.entries)
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

  await tx
    .insert(workspaceFileSecretProvenance)
    .values({ fileId, contentUpdatedAt, status: 'unknown', entries: [], updatedAt: new Date() })
    .onConflictDoUpdate({
      target: workspaceFileSecretProvenance.fileId,
      set: { contentUpdatedAt, status: 'unknown', entries: [], updatedAt: new Date() },
    })
  await markWorkspaceFileSecretProvenanceTrackedInTx(tx, fileId, contentUpdatedAt)
}

/** Initializes provenance for an exact file version without replacing an existing classification. */
export async function initializeWorkspaceFileSecretProvenanceInTx(
  tx: DbTransaction,
  fileId: string,
  contentUpdatedAt: Date,
  provenance: WorkspaceFileSecretProvenance
): Promise<void> {
  const entries = provenance.status === 'exact' ? normalizeExactEntries(provenance.entries) : []
  await tx
    .insert(workspaceFileSecretProvenance)
    .values({
      fileId,
      contentUpdatedAt,
      status: provenance.status,
      entries,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
  await markWorkspaceFileSecretProvenanceTrackedInTx(tx, fileId, contentUpdatedAt)
}

/** Advances an intentionally preserved classification to the file's new content version. */
export async function preserveWorkspaceFileSecretProvenanceInTx(
  tx: DbTransaction,
  fileId: string,
  previousContentUpdatedAt: Date,
  previousSecretProvenanceVersion: number | null,
  nextContentUpdatedAt: Date
): Promise<void> {
  const [stored] = await tx
    .select({ contentUpdatedAt: workspaceFileSecretProvenance.contentUpdatedAt })
    .from(workspaceFileSecretProvenance)
    .where(eq(workspaceFileSecretProvenance.fileId, fileId))
    .limit(1)
  if (!stored) {
    await replaceWorkspaceFileSecretProvenanceInTx(
      tx,
      fileId,
      nextContentUpdatedAt,
      previousSecretProvenanceVersion === null
        ? EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE
        : { status: 'unknown' }
    )
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
  if (source.secretProvenanceVersion !== null && source.secretProvenanceVersion !== 1) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
      status: 'unknown',
    })
    return
  }
  if (source.status === null && source.secretProvenanceVersion === null) {
    await replaceWorkspaceFileSecretProvenanceInTx(tx, targetFileId, target.contentUpdatedAt, {
      status: 'exact',
      entries: [],
    })
    return
  }
  if (
    source.provenanceContentUpdatedAt?.getTime() !== source.fileContentUpdatedAt.getTime() ||
    source.status !== 'exact' ||
    !isValidStoredEntries(source.entries) ||
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
    entries: source.entries,
  })
}

/** Marks legacy Function exports unknown, constrained to canonical rows in the caller's workspace. */
export async function markWorkspaceFileSecretProvenanceUnknown(
  workspaceId: string,
  fileIds: readonly string[]
): Promise<void> {
  const uniqueIds = [...new Set(fileIds.filter((fileId) => fileId.length > 0))]
  if (uniqueIds.length === 0) return
  if (uniqueIds.length > MAX_FUNCTION_EXPORT_PROVENANCE_FILES) {
    throw new Error('Too many Function export files to classify')
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: workspaceFiles.id, contentUpdatedAt: workspaceFiles.contentUpdatedAt })
      .from(workspaceFiles)
      .where(
        and(
          inArray(workspaceFiles.id, uniqueIds),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt)
        )
      )
    if (rows.length !== uniqueIds.length) {
      throw new Error('Function export file provenance could not be bound to canonical records')
    }
    for (const row of rows) {
      await replaceWorkspaceFileSecretProvenanceInTx(tx, row.id, row.contentUpdatedAt, {
        status: 'unknown',
      })
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
        eq(workspaceFiles.context, identity.context),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)

  if (!row) return { status: 'unknown' }
  if (row.secretProvenanceVersion !== null && row.secretProvenanceVersion !== 1) {
    return { status: 'unknown' }
  }
  if (row.status === null) {
    return row.secretProvenanceVersion === null
      ? { status: 'exact', entries: [] }
      : { status: 'unknown' }
  }
  if (
    row.provenanceContentUpdatedAt?.getTime() !== row.fileContentUpdatedAt.getTime() ||
    row.status !== 'exact' ||
    !isValidStoredEntries(row.entries)
  ) {
    return { status: 'unknown' }
  }
  return { status: 'exact', entries: row.entries }
}

/**
 * Activates only stored secret values that occur in this exact model-visible result. Opaque
 * attachments cannot be semantically scanned, so any nonempty or unknown provenance rejects them.
 */
export async function importWorkspaceFileSecretProvenanceForValue(args: {
  workspaceId: string
  identity: WorkspaceFileSecretProvenanceIdentity
  value: unknown
  registry?: ResolvedSecretTraceRegistry
  opaqueAttachment?: boolean
}): Promise<boolean> {
  const provenance = await getBoundWorkspaceFileSecretProvenance(args.workspaceId, args.identity)
  if (provenance.status === 'unknown') return false
  if (provenance.entries.length === 0) return true
  if (args.opaqueAttachment || !args.registry) return false

  return args.registry.importProvenanceForValue(
    {
      version: 1,
      complete: true,
      entries: provenance.entries,
    },
    args.value,
    { trusted: true }
  )
}

/**
 * Removes model attachments whose canonical workspace-file record is tainted, unknown, or does
 * not match the supplied file id. Missing legacy records remain compatible; any persisted record
 * is classified exclusively by its trusted key/id binding and private provenance row.
 */
export async function filterModelSafeWorkspaceFileAttachments<
  TAttachment extends WorkspaceFileAttachmentIdentity,
>(
  attachments: readonly TAttachment[],
  options: { workspaceId?: string } = {}
): Promise<TAttachment[]> {
  if (attachments.length === 0) return []
  if (attachments.length > MAX_MODEL_ATTACHMENT_PROVENANCE_LOOKUPS) {
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

  const rows = await db
    .select({
      id: workspaceFiles.id,
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
    .where(and(inArray(workspaceFiles.key, keys), isNull(workspaceFiles.deletedAt)))

  const rowByKey = new Map(rows.map((row) => [row.key, row]))
  return attachments.filter((attachment) => {
    if (typeof attachment.key !== 'string' || attachment.key.length === 0) return true
    const row = rowByKey.get(attachment.key)
    if (!row) return true
    if (row.context !== 'workspace' && row.context !== 'mothership') return true
    if (typeof attachment.id !== 'string' || attachment.id !== row.id) return false
    if (options.workspaceId && row.workspaceId !== options.workspaceId) return false
    if (row.secretProvenanceVersion !== null && row.secretProvenanceVersion !== 1) return false
    if (row.status === null) return row.secretProvenanceVersion === null
    if (
      row.provenanceContentUpdatedAt?.getTime() !== row.fileContentUpdatedAt.getTime() ||
      row.status !== 'exact' ||
      !isValidStoredEntries(row.entries)
    ) {
      return false
    }
    return row.entries.length === 0
  })
}
