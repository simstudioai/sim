import { db } from '@sim/db'
import {
  type WorkspaceFileRow,
  type WorkspaceFileVersionRow,
  type WorkspaceFileVersionSource,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm'
import {
  type CursorKey,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  numberKey,
  resumeKeyset,
} from '@/lib/api/list-query'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenanceSnapshot } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { enqueueWorkspaceFileStorageCleanups } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'

/** A coalescing version stops absorbing writes this long after it was opened. */
const FILE_VERSION_COALESCE_WINDOW_MS = 10 * 60 * 1000
/** A coalescing version also closes once its writer has been idle this long. */
const FILE_VERSION_COALESCE_IDLE_MS = 5 * 60 * 1000
/**
 * Hard ceiling on superseded versions kept per file, enforced inline on every new version so a
 * write loop stays bounded between retention runs. Plan-specific counts are enforced by retention.
 */
export const MAX_SUPERSEDED_FILE_VERSIONS = 500
/**
 * Bounds the attribution list a long collaborative window can accumulate. Also keeps a full page of
 * versions within the user-email batch the v2 presenter resolves in one query.
 */
const MAX_VERSION_AUTHORS = 10
/**
 * An implicit version 1 is attributed to the uploader only when the file was never overwritten,
 * which holds when its content version still matches its upload time.
 */
const ORIGINAL_UPLOAD_TOLERANCE_MS = 1000

/**
 * High-frequency writers whose consecutive writes fold into one version: the collaborative editor
 * persists every few seconds, and a workflow can rewrite a file on every run. Every other source is
 * a deliberate write and always gets its own version.
 */
const COALESCING_SOURCES: ReadonlySet<WorkspaceFileVersionSource> = new Set(['collab', 'workflow'])

/** How the write being committed should be recorded in the file's history. */
export interface WorkspaceFileVersionWrite {
  source: WorkspaceFileVersionSource
  /** The acting user; null for actorless callers such as workspace API keys. */
  authorUserId: string | null
  restoredFromVersion?: number
}

/**
 * Every version column except the stored provenance entries, which can be large and are read only
 * when a revert reinstates them.
 */
const versionSummaryColumns = {
  id: workspaceFileVersion.id,
  fileId: workspaceFileVersion.fileId,
  version: workspaceFileVersion.version,
  key: workspaceFileVersion.key,
  sizeBytes: workspaceFileVersion.sizeBytes,
  contentType: workspaceFileVersion.contentType,
  contentHash: workspaceFileVersion.contentHash,
  supersededAt: workspaceFileVersion.supersededAt,
  source: workspaceFileVersion.source,
  authorUserIds: workspaceFileVersion.authorUserIds,
  restoredFromVersion: workspaceFileVersion.restoredFromVersion,
  createdAt: workspaceFileVersion.createdAt,
  updatedAt: workspaceFileVersion.updatedAt,
}

/** A version row without its provenance snapshot. */
export type WorkspaceFileVersionSummaryRow = Omit<
  WorkspaceFileVersionRow,
  'workspaceId' | 'secretProvenanceStatus' | 'secretProvenanceEntries'
>

/** The newest version row of a file; a writer must read it under the file row's FOR UPDATE lock. */
export async function loadWorkspaceFileVersionHead(
  fileId: string,
  executor: DbOrTx = db
): Promise<WorkspaceFileVersionSummaryRow | undefined> {
  const [head] = await executor
    .select(versionSummaryColumns)
    .from(workspaceFileVersion)
    .where(eq(workspaceFileVersion.fileId, fileId))
    .orderBy(desc(workspaceFileVersion.version))
    .limit(1)
  return head
}

/**
 * Whether the head row describes the file's current bytes. When it does not — no rows yet, or a
 * writer changed the key outside this module — the outgoing bytes must be materialized as their own
 * version before the new one is recorded, so the caller snapshots their provenance first.
 */
export function isVersionHeadCurrent(
  head: WorkspaceFileVersionSummaryRow | undefined,
  file: Pick<WorkspaceFileRow, 'key'>
): boolean {
  return head !== undefined && head.supersededAt === null && head.key === file.key
}

/** Whether a file's current bytes are still the ones originally uploaded. */
function isOriginalUploadContent(
  file: Pick<WorkspaceFileRow, 'uploadedAt' | 'contentUpdatedAt'>
): boolean {
  return (
    Math.abs(file.contentUpdatedAt.getTime() - file.uploadedAt.getTime()) <=
    ORIGINAL_UPLOAD_TOLERANCE_MS
  )
}

function canCoalesce(
  head: WorkspaceFileVersionSummaryRow,
  write: WorkspaceFileVersionWrite,
  now: Date
): boolean {
  if (head.source !== write.source || !COALESCING_SOURCES.has(write.source)) return false
  if (write.source !== 'collab' && head.authorUserIds[0] !== (write.authorUserId ?? undefined)) {
    return false
  }
  return (
    now.getTime() - head.createdAt.getTime() < FILE_VERSION_COALESCE_WINDOW_MS &&
    now.getTime() - head.updatedAt.getTime() < FILE_VERSION_COALESCE_IDLE_MS
  )
}

function mergeAuthors(existing: readonly string[], authorUserId: string | null): string[] {
  if (!authorUserId || existing.includes(authorUserId)) return [...existing]
  return [...existing, authorUserId].slice(0, MAX_VERSION_AUTHORS)
}

/** The version columns that describe one content state of a file. */
function contentColumns(file: WorkspaceFileRow, provenance: WorkspaceFileSecretProvenanceSnapshot) {
  return {
    key: file.key,
    sizeBytes: getWorkspaceFileSize(file),
    contentType: file.contentType,
    secretProvenanceStatus: provenance.status,
    secretProvenanceEntries: provenance.entries,
  }
}

async function supersedeVersionInTx(tx: DbTransaction, versionId: string, now: Date) {
  await tx
    .update(workspaceFileVersion)
    .set({ supersededAt: now, updatedAt: now })
    .where(eq(workspaceFileVersion.id, versionId))
}

interface RecordWorkspaceFileVersionParams {
  /** The workspace the write was scoped to; the file row's column is nullable for other contexts. */
  workspaceId: string
  /** Head row loaded before the file row was updated. */
  head: WorkspaceFileVersionSummaryRow | undefined
  /** The file row as it was before this write (locked). */
  previous: WorkspaceFileRow
  /**
   * Provenance of `previous`'s bytes, captured before the provenance step; required when the head is
   * not current.
   */
  previousProvenance: WorkspaceFileSecretProvenanceSnapshot | undefined
  /** The file row after this write. */
  next: WorkspaceFileRow
  nextProvenance: WorkspaceFileSecretProvenanceSnapshot
  contentHash: string
  write: WorkspaceFileVersionWrite
  now: Date
}

/** The outcome of recording one content write. */
interface RecordedWorkspaceFileVersion {
  /** Version number of the file's current content after the write. */
  version: number
  /** Storage keys no version references any more; the caller releases them after commit. */
  releasedKeys: string[]
}

/**
 * Records a committed content write in the file's history. Runs inside the content-write
 * transaction, under the file row's lock, which serializes version numbering and coalescing
 * decisions per file.
 *
 * An empty file with no history is a shell whose content arrives in this write (a create followed
 * by its first content), so the shell is not kept as a version of its own.
 */
export async function recordWorkspaceFileVersionInTx(
  tx: DbTransaction,
  params: RecordWorkspaceFileVersionParams
): Promise<RecordedWorkspaceFileVersion> {
  const { previous, next, now, write } = params
  let head = params.head

  if (!head && getWorkspaceFileSize(previous) === 0) {
    await insertVersion(tx, params, 1)
    return { version: 1, releasedKeys: [previous.key] }
  }

  if (!head || !isVersionHeadCurrent(head, previous)) {
    if (!params.previousProvenance) {
      throw new Error('Outgoing workspace file content needs a provenance snapshot to be versioned')
    }
    if (head && head.supersededAt === null) await supersedeVersionInTx(tx, head.id, now)
    const original = !head && isOriginalUploadContent(previous)
    const [materialized] = await tx
      .insert(workspaceFileVersion)
      .values({
        id: generateId(),
        fileId: previous.id,
        workspaceId: params.workspaceId,
        version: (head?.version ?? 0) + 1,
        ...contentColumns(previous, params.previousProvenance),
        contentHash: null,
        source: original ? 'upload' : 'unknown',
        authorUserIds: original ? [previous.userId] : [],
        createdAt: previous.contentUpdatedAt,
        updatedAt: previous.contentUpdatedAt,
      })
      .returning(versionSummaryColumns)
    head = materialized
  }

  const nextColumns = { ...contentColumns(next, params.nextProvenance), updatedAt: now }

  if (head.contentHash === params.contentHash) {
    await tx
      .update(workspaceFileVersion)
      .set(nextColumns)
      .where(eq(workspaceFileVersion.id, head.id))
    return { version: head.version, releasedKeys: [previous.key] }
  }

  if (canCoalesce(head, write, now)) {
    await tx
      .update(workspaceFileVersion)
      .set({
        ...nextColumns,
        contentHash: params.contentHash,
        authorUserIds: mergeAuthors(head.authorUserIds, write.authorUserId),
      })
      .where(eq(workspaceFileVersion.id, head.id))
    return { version: head.version, releasedKeys: [previous.key] }
  }

  await supersedeVersionInTx(tx, head.id, now)
  const version = head.version + 1
  await insertVersion(tx, params, version)

  /** Numbers are assigned consecutively, so a file cannot exceed the ceiling before this number. */
  const releasedKeys =
    version > MAX_SUPERSEDED_FILE_VERSIONS + 1
      ? await pruneExcessWorkspaceFileVersionsInTx(tx, next.id)
      : []
  return { version, releasedKeys }
}

/** Inserts the new current version described by a write. */
async function insertVersion(
  tx: DbTransaction,
  { workspaceId, next, nextProvenance, contentHash, write, now }: RecordWorkspaceFileVersionParams,
  version: number
): Promise<void> {
  await tx.insert(workspaceFileVersion).values({
    id: generateId(),
    fileId: next.id,
    workspaceId,
    version,
    ...contentColumns(next, nextProvenance),
    contentHash,
    source: write.source,
    authorUserIds: write.authorUserId ? [write.authorUserId] : [],
    restoredFromVersion: write.restoredFromVersion ?? null,
    createdAt: now,
    updatedAt: now,
  })
}

/** The outcome of deleting one version; a deleted version's key is released after commit. */
export type WorkspaceFileVersionDeletion =
  | { status: 'deleted'; key: string }
  | { status: 'not_found' }
  | { status: 'newest' }

/**
 * Deletes one superseded version. The newest row is never deleted: it is either the current version
 * or the last one recorded before bytes a later write has not recorded yet, and removing it would let
 * the next write reuse its number.
 */
export async function deleteWorkspaceFileVersionInTx(
  tx: DbTransaction,
  fileId: string,
  version: number
): Promise<WorkspaceFileVersionDeletion> {
  const [deleted] = await tx
    .delete(workspaceFileVersion)
    .where(
      and(
        eq(workspaceFileVersion.fileId, fileId),
        eq(workspaceFileVersion.version, version),
        isNotNull(workspaceFileVersion.supersededAt)
      )
    )
    .returning({ key: workspaceFileVersion.key })
  if (deleted) return { status: 'deleted', key: deleted.key }
  const [kept] = await tx
    .select({ version: workspaceFileVersion.version })
    .from(workspaceFileVersion)
    .where(and(eq(workspaceFileVersion.fileId, fileId), eq(workspaceFileVersion.version, version)))
    .limit(1)
  return kept ? { status: 'newest' } : { status: 'not_found' }
}

/**
 * Releases the history of soft-deleted files inside the transaction that purges their rows: it
 * locks the files still deleted before `deletedBefore`, deletes their superseded version rows, and
 * enqueues those objects on the durable storage-cleanup outbox. Sharing the purge's transaction
 * means history is released exactly when the file row is deleted — a failed purge rolls both back —
 * and the row lock orders it against a restore, which updates the same row. The current version's
 * row cascades with the file, whose own object the purge deletes.
 */
export async function releaseWorkspaceFileVersionsForPurgeInTx(
  tx: DbTransaction,
  fileIds: readonly string[],
  deletedBefore: Date
): Promise<void> {
  if (fileIds.length === 0) return
  const expired = await tx
    .select({ id: workspaceFiles.id, key: workspaceFiles.key })
    .from(workspaceFiles)
    .where(
      and(
        inArray(workspaceFiles.id, [...fileIds]),
        isNotNull(workspaceFiles.deletedAt),
        lt(workspaceFiles.deletedAt, deletedBefore)
      )
    )
    .for('update')
  if (expired.length === 0) return
  const released = await tx
    .delete(workspaceFileVersion)
    .where(
      and(
        inArray(
          workspaceFileVersion.fileId,
          expired.map((file) => file.id)
        ),
        notInArray(
          workspaceFileVersion.key,
          expired.map((file) => file.key)
        )
      )
    )
    .returning({ key: workspaceFileVersion.key })
  await enqueueWorkspaceFileStorageCleanups(
    tx,
    released.map((row) => row.key)
  )
}

/** Deletes superseded versions beyond {@link MAX_SUPERSEDED_FILE_VERSIONS}, returning their keys. */
async function pruneExcessWorkspaceFileVersionsInTx(
  tx: DbTransaction,
  fileId: string
): Promise<string[]> {
  const excess = await tx
    .select({ id: workspaceFileVersion.id })
    .from(workspaceFileVersion)
    .where(
      and(eq(workspaceFileVersion.fileId, fileId), isNotNull(workspaceFileVersion.supersededAt))
    )
    .orderBy(desc(workspaceFileVersion.version))
    .offset(MAX_SUPERSEDED_FILE_VERSIONS)
  if (excess.length === 0) return []
  const removed = await tx
    .delete(workspaceFileVersion)
    .where(
      inArray(
        workspaceFileVersion.id,
        excess.map((row) => row.id)
      )
    )
    .returning({ key: workspaceFileVersion.key })
  return removed.map((row) => row.key)
}

/** The file fields that identify its current bytes. */
type WorkspaceFileVersionSubject = Pick<
  WorkspaceFileRecord,
  'id' | 'key' | 'size' | 'type' | 'uploadedBy' | 'uploadedAt' | 'updatedAt' | 'contentUpdatedAt'
>

/** One version of a workspace file as readers see it. */
export interface WorkspaceFileVersionRecord {
  fileId: string
  version: number
  key: string
  size: number
  contentType: string
  source: WorkspaceFileVersionSource
  authorUserIds: string[]
  restoredFromVersion: number | null
  isCurrent: boolean
  createdAt: Date
  updatedAt: Date
  supersededAt: Date | null
}

/** Reads a stored status back, treating anything unrecognized as unknown so a revert fails closed. */
function toSnapshotStatus(status: string | null): WorkspaceFileSecretProvenanceSnapshot['status'] {
  if (status === null || status === 'exact' || status === 'unknown' || status === 'unrecorded') {
    return status
  }
  return 'unknown'
}

/**
 * A stored version as readers see it. A row is current only while it still holds the file's bytes;
 * a newest row a later write has replaced without recording (see {@link implicitCurrentVersion})
 * reads as superseded from the moment that write landed.
 */
function toVersionRecord(
  row: WorkspaceFileVersionSummaryRow,
  file: WorkspaceFileVersionSubject
): WorkspaceFileVersionRecord {
  const isCurrent = row.supersededAt === null && row.key === file.key
  return {
    fileId: row.fileId,
    version: row.version,
    key: row.key,
    size: row.sizeBytes,
    contentType: row.contentType,
    source: row.source,
    authorUserIds: row.authorUserIds,
    restoredFromVersion: row.restoredFromVersion,
    isCurrent,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    supersededAt: isCurrent ? null : (row.supersededAt ?? contentVersionTime(file)),
  }
}

function contentVersionTime(file: WorkspaceFileVersionSubject): Date {
  return file.contentUpdatedAt ?? file.updatedAt
}

/**
 * The version a file's current bytes hold while no row records them, for a caller that has found
 * {@link isVersionHeadCurrent} false. That is version 1 of a file with no history, or the number
 * after a newest row that describes other bytes — left by a content write that skipped recording,
 * such as one from a build that predates version history. Numbered and attributed exactly as
 * {@link recordWorkspaceFileVersionInTx} will materialize it on the next write, so the version a
 * reader sees keeps its identity once it becomes a row.
 */
function implicitCurrentVersion(
  file: WorkspaceFileVersionSubject,
  head: WorkspaceFileVersionSummaryRow | undefined
): WorkspaceFileVersionRecord {
  const contentUpdatedAt = contentVersionTime(file)
  const original =
    !head && isOriginalUploadContent({ uploadedAt: file.uploadedAt, contentUpdatedAt })
  return {
    fileId: file.id,
    version: (head?.version ?? 0) + 1,
    key: file.key,
    size: file.size,
    contentType: file.type,
    source: original ? 'upload' : 'unknown',
    authorUserIds: original ? [file.uploadedBy] : [],
    restoredFromVersion: null,
    isCurrent: true,
    createdAt: contentUpdatedAt,
    updatedAt: contentUpdatedAt,
    supersededAt: null,
  }
}

const VERSION_KEYSET: readonly KeysetKey<{ version: number }>[] = [
  numberKey(workspaceFileVersion.version, (row) => row.version),
]

/** A page of a file's versions ordered by version number, resumable by keyset. */
export async function queryWorkspaceFileVersions(
  file: WorkspaceFileVersionSubject,
  options: { sortOrder: ListSortOrder; limit: number; after?: CursorKey[] }
): Promise<{ versions: WorkspaceFileVersionRecord[]; nextKeys: CursorKey[] | null }> {
  const resume = resumeKeyset(VERSION_KEYSET, options.after, options.sortOrder)
  const [rows, head] = await Promise.all([
    db
      .select(versionSummaryColumns)
      .from(workspaceFileVersion)
      .where(and(eq(workspaceFileVersion.fileId, file.id), resume))
      .orderBy(...listOrderBy(keysetColumns(VERSION_KEYSET), options.sortOrder))
      .limit(options.limit + 1),
    loadWorkspaceFileVersionHead(file.id),
  ])
  const records = rows.map((row) => toVersionRecord(row, file))
  /**
   * The implicit current version numbers above every row, so it leads a descending list and ends an
   * ascending one; a cursor already past it leaves it out. Over-fetching by one row still decides
   * whether another page follows, since the cut keeps the first `limit` records either way.
   */
  const implicit = isVersionHeadCurrent(head, file) ? null : implicitCurrentVersion(file, head)
  const resumeAfter = options.after?.[0]
  if (
    implicit &&
    (typeof resumeAfter !== 'number' ||
      (options.sortOrder === 'desc'
        ? implicit.version < resumeAfter
        : implicit.version > resumeAfter))
  ) {
    if (options.sortOrder === 'desc') records.unshift(implicit)
    else records.push(implicit)
  }
  const page = keysetPage(VERSION_KEYSET, records, options.limit)
  return { versions: page.data, nextKeys: page.nextCursorKeys }
}

/**
 * The subset of `keys` held by any version row. Callers ask only about keys with no active file row,
 * so a match is a superseded version or an archived file's current bytes — both reachable only
 * through authorized file and version routes. Key-addressed readers refuse them rather than fall
 * back to the object's own metadata or treat them as untracked legacy files.
 */
export async function findWorkspaceFileVersionKeys(keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const rows = await db
    .select({ key: workspaceFileVersion.key })
    .from(workspaceFileVersion)
    .where(inArray(workspaceFileVersion.key, [...keys]))
  return new Set(rows.map((row) => row.key))
}

/** The version holding the file's current bytes, recorded or implicit. */
export async function getCurrentWorkspaceFileVersion(
  file: WorkspaceFileVersionSubject
): Promise<WorkspaceFileVersionRecord> {
  const head = await loadWorkspaceFileVersionHead(file.id)
  return head && isVersionHeadCurrent(head, file)
    ? toVersionRecord(head, file)
    : implicitCurrentVersion(file, head)
}

/**
 * The current version number of the enclosing query's `workspace_files` row, as a correlated
 * subquery so the row and its number come from one statement's snapshot. The newest row numbers
 * the file's bytes while it still holds them; otherwise the bytes are on the implicit version after
 * it, and a file with no rows is on version 1 — the numbering {@link implicitCurrentVersion} gives.
 * Both sides of the correlation are table-qualified because Drizzle renders single-table columns
 * bare, which would bind the outer columns to this subquery's own table.
 */
export function currentWorkspaceFileVersionNumberSql() {
  const qualified = (table: typeof workspaceFileVersion | typeof workspaceFiles, name: string) =>
    sql`${table}.${sql.identifier(name)}`
  const head = {
    fileId: qualified(workspaceFileVersion, workspaceFileVersion.fileId.name),
    version: qualified(workspaceFileVersion, workspaceFileVersion.version.name),
    key: qualified(workspaceFileVersion, workspaceFileVersion.key.name),
    supersededAt: qualified(workspaceFileVersion, workspaceFileVersion.supersededAt.name),
  }
  const file = {
    id: qualified(workspaceFiles, workspaceFiles.id.name),
    key: qualified(workspaceFiles, workspaceFiles.key.name),
  }
  const number = sql`case when ${head.supersededAt} is null and ${head.key} = ${file.key} then ${head.version} else ${head.version} + 1 end`
  return sql<number>`coalesce((
    select ${number} from ${workspaceFileVersion}
    where ${head.fileId} = ${file.id}
    order by ${head.version} desc
    limit 1
  ), 1)`.mapWith(Number)
}

/** One version of a file, or null when it never existed or retention removed it. */
export async function getWorkspaceFileVersion(
  file: WorkspaceFileVersionSubject,
  version: number
): Promise<WorkspaceFileVersionRecord | null> {
  const [row] = await db
    .select(versionSummaryColumns)
    .from(workspaceFileVersion)
    .where(and(eq(workspaceFileVersion.fileId, file.id), eq(workspaceFileVersion.version, version)))
    .limit(1)
  if (row) return toVersionRecord(row, file)
  const current = await getCurrentWorkspaceFileVersion(file)
  return current.version === version ? current : null
}

/**
 * The provenance captured with one stored version's bytes, which a revert reinstates; null when the
 * row is gone, so a caller never reinstates a classification it did not read.
 */
export async function getWorkspaceFileVersionProvenance(
  fileId: string,
  version: number
): Promise<WorkspaceFileSecretProvenanceSnapshot | null> {
  const [row] = await db
    .select({
      status: workspaceFileVersion.secretProvenanceStatus,
      entries: workspaceFileVersion.secretProvenanceEntries,
    })
    .from(workspaceFileVersion)
    .where(and(eq(workspaceFileVersion.fileId, fileId), eq(workspaceFileVersion.version, version)))
    .limit(1)
  if (!row) return null
  return { status: toSnapshotStatus(row.status), entries: row.entries }
}

/** Storage keys of every version of a file, for releasing them with the file row. */
export async function listWorkspaceFileVersionKeysInTx(
  tx: DbTransaction,
  fileId: string
): Promise<string[]> {
  const rows = await tx
    .select({ key: workspaceFileVersion.key })
    .from(workspaceFileVersion)
    .where(eq(workspaceFileVersion.fileId, fileId))
  return rows.map((row) => row.key)
}
