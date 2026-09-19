import { db } from '@sim/db'
import {
  type WorkspaceFileRow,
  type WorkspaceFileVersionRow,
  type WorkspaceFileVersionSource,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, inArray, isNotNull, lt, notInArray } from 'drizzle-orm'
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

/** sha256 (hex) of stored bytes — the identity used to detect rewrites of identical content. */
export function hashWorkspaceFileContent(content: Buffer): string {
  return sha256Hex(content)
}

/**
 * The newest version row of a file. A writer reads it inside its transaction under the file row's
 * FOR UPDATE lock; a reader reads it on its own so it never pairs rows from after a concurrent first
 * write with a file record from before it.
 */
export async function loadWorkspaceFileVersionHead(
  fileId: string,
  executor: DbOrTx = db
): Promise<WorkspaceFileVersionRow | undefined> {
  const [head] = await executor
    .select()
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
  head: WorkspaceFileVersionRow | undefined,
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
  head: WorkspaceFileVersionRow,
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
    contentUpdatedAt: file.contentUpdatedAt,
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
  head: WorkspaceFileVersionRow | undefined
  /** The file row as it was before this write (locked). */
  previous: WorkspaceFileRow
  /** Provenance of `previous`'s bytes, captured before the provenance step; required when the head is not current. */
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
      .returning()
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

  /** Version numbers are dense per file, so a file cannot exceed the ceiling before this number. */
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

/**
 * Deletes one superseded version, returning its storage key for release after commit, or null when
 * no such superseded version exists. The current version is never deletable: it is the file.
 */
export async function deleteWorkspaceFileVersionInTx(
  tx: DbTransaction,
  fileId: string,
  version: number
): Promise<string | null> {
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
  return deleted?.key ?? null
}

/** Most cleanup events one outbox insert may carry. */
const RELEASE_ENQUEUE_CHUNK_SIZE = 1000

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
  for (let offset = 0; offset < released.length; offset += RELEASE_ENQUEUE_CHUNK_SIZE) {
    await enqueueWorkspaceFileStorageCleanups(
      tx,
      released.slice(offset, offset + RELEASE_ENQUEUE_CHUNK_SIZE).map((row) => row.key)
    )
  }
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
  secretProvenance: WorkspaceFileSecretProvenanceSnapshot
}

/** Reads a stored status back, treating anything unrecognized as unknown so a revert fails closed. */
function toSnapshotStatus(status: string | null): WorkspaceFileSecretProvenanceSnapshot['status'] {
  if (status === null || status === 'exact' || status === 'unknown' || status === 'unrecorded') {
    return status
  }
  return 'unknown'
}

function toVersionRecord(row: WorkspaceFileVersionRow): WorkspaceFileVersionRecord {
  return {
    fileId: row.fileId,
    version: row.version,
    key: row.key,
    size: row.sizeBytes,
    contentType: row.contentType,
    source: row.source,
    authorUserIds: row.authorUserIds,
    restoredFromVersion: row.restoredFromVersion,
    isCurrent: row.supersededAt === null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    supersededAt: row.supersededAt,
    secretProvenance: {
      status: toSnapshotStatus(row.secretProvenanceStatus),
      entries: row.secretProvenanceEntries,
    },
  }
}

/**
 * Version 1 of a file with no history yet — every file before its first content write. Attributed
 * exactly as {@link recordWorkspaceFileVersionInTx} will materialize it, so the version a reader sees
 * keeps its identity once it becomes a row. Its provenance is read live by callers that need it,
 * since the sidecar still describes these bytes.
 */
function implicitFirstVersion(file: WorkspaceFileVersionSubject): WorkspaceFileVersionRecord {
  const contentUpdatedAt = file.contentUpdatedAt ?? file.updatedAt
  const original = isOriginalUploadContent({ uploadedAt: file.uploadedAt, contentUpdatedAt })
  return {
    fileId: file.id,
    version: 1,
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
    secretProvenance: { status: null, entries: [] },
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
  const rows = await db
    .select()
    .from(workspaceFileVersion)
    .where(and(eq(workspaceFileVersion.fileId, file.id), resume))
    .orderBy(...listOrderBy(keysetColumns(VERSION_KEYSET), options.sortOrder))
    .limit(options.limit + 1)
  const records = rows.map(toVersionRecord)
  /**
   * An uncursored page that is empty means the file has no rows, so it lists its implicit version 1.
   * Any cursor was minted past that version already, so only the first page can carry it.
   */
  if (records.length === 0 && !options.after) {
    records.push(implicitFirstVersion(file))
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

/** The current version, or the implicit version 1 of a file with no history rows. */
export async function getCurrentWorkspaceFileVersion(
  file: WorkspaceFileVersionSubject
): Promise<WorkspaceFileVersionRecord> {
  const head = await loadWorkspaceFileVersionHead(file.id)
  return head ? toVersionRecord(head) : implicitFirstVersion(file)
}

/**
 * The version number of the content a file record describes, matched by the record's storage key so
 * it stays exact even if a write committed after the record was read. Returns null when the record
 * is stale in a way its key cannot answer — a later write replaced those bytes within their version
 * and released the key — so the caller re-reads the record rather than guess.
 */
export async function getWorkspaceFileVersionNumberForRecord(
  file: Pick<WorkspaceFileVersionSubject, 'id' | 'key'>
): Promise<number | null> {
  const [row] = await db
    .select({ version: workspaceFileVersion.version })
    .from(workspaceFileVersion)
    .where(and(eq(workspaceFileVersion.fileId, file.id), eq(workspaceFileVersion.key, file.key)))
    .limit(1)
  if (row) return row.version
  return (await loadWorkspaceFileVersionHead(file.id)) ? null : 1
}

/** One version of a file, or null when it never existed or retention removed it. */
export async function getWorkspaceFileVersion(
  file: WorkspaceFileVersionSubject,
  version: number
): Promise<WorkspaceFileVersionRecord | null> {
  const [row] = await db
    .select()
    .from(workspaceFileVersion)
    .where(and(eq(workspaceFileVersion.fileId, file.id), eq(workspaceFileVersion.version, version)))
    .limit(1)
  if (row) return toVersionRecord(row)
  if (version !== 1 || (await loadWorkspaceFileVersionHead(file.id))) return null
  return implicitFirstVersion(file)
}
