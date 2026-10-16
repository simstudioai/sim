import { db } from '@sim/db'
import {
  copilotChats,
  document,
  executionLargeValues,
  knowledgeBase,
  user,
  workspaceFile,
  workspaceFiles,
  workspaceFileVersion,
  workspace as workspaceTable,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import {
  continueOutboxHandler,
  deferOutboxHandler,
  enqueueOutboxEvents,
  MAX_BULK_ENQUEUE_EVENTS,
  type OutboxEventContext,
  type OutboxHandler,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'
import {
  deleteStorageKeysUnderPrefix,
  listStorageKeyPage,
  storageCleanupAvailableAt,
} from '@/lib/projects/files/prefix-cleanup'
import type { StorageContext } from '@/lib/uploads/config'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import {
  ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT,
  ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT,
} from '@/lib/users/storage-sweep-events'

const logger = createLogger('AccountStorageSweep')

const ROW_PAGE_SIZE = 1000
const OBJECTS_PER_EVENT = 100
const DEADLINE_MARGIN_MS = 5000

/**
 * Ceiling on exact keys one deletion records for durable cleanup. Past it the rest are logged
 * and left; the workspace prefix sweeps are unaffected, since they list storage instead.
 */
const MAX_DURABLE_OBJECTS = 100_000

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Every storage family whose keys embed their workspace as the second path segment, in the
 * bucket that serves it. A deleted workspace's objects in these families are found by listing,
 * so neither a missing row nor a row written after the deletion read its keys can strand one.
 */
const WORKSPACE_STORAGE_FAMILIES = [
  { root: 'workspace', context: 'workspace' },
  { root: 'table-import', context: 'table-import' },
  { root: 'execution', context: 'execution' },
  { root: 'table-snapshots', context: 'execution' },
  { root: 'copilot-doc-compiled', context: 'copilot' },
  { root: 'workspace-logos', context: 'workspace-logos' },
] as const satisfies readonly { root: string; context: StorageContext }[]

/**
 * Mirrors the contexts `reassignSharedResourceOwnershipForWorkspaceMemberRemovalTx` hands to a
 * successor. Drift toward fewer contexts only queues keys the reference guard then keeps.
 */
const HANDED_OFF_FILE_CONTEXTS = [
  'workspace',
  'knowledge-base',
  'execution',
  'chat',
  'workspace-logos',
] as const

const OBJECT_CONTEXTS: ReadonlySet<string> = new Set<StorageContext>([
  'workspace',
  'mothership',
  'copilot',
  'chat',
  'knowledge-base',
  'execution',
  'table-import',
  'workspace-logos',
  'profile-pictures',
])

/** Keys another lifecycle owns: Project prefix cleanup and the Assistant upload-session sweep. */
const FOREIGN_LIFECYCLE_ROOTS = ['project/', 'assistant/'] as const

interface StorageObject {
  key: string
  context: StorageContext
}

interface WorkspaceSweepPayload {
  workspaceId: string
  family: number
}

interface ObjectCleanupPayload {
  userId: string
  objects: StorageObject[]
  cursor: number
}

/** The trailing slash keeps `workspace/ws1/` from matching `workspace/ws10/...`. */
function workspaceStoragePrefix(root: string, workspaceId: string): string {
  if (!SAFE_ID.test(workspaceId)) throw new Error('Invalid workspace storage identity')
  return `${root}/${workspaceId}/`
}

function deadlineNear(context: Pick<OutboxEventContext, 'deadlineAt'>): boolean {
  return Boolean(context.deadlineAt && Date.now() + DEADLINE_MARGIN_MS >= context.deadlineAt)
}

function parseWorkspaceSweep(value: unknown): WorkspaceSweepPayload {
  if (!isRecordLike(value) || value.version !== 1 || typeof value.workspaceId !== 'string')
    throw new Error('Invalid workspace storage sweep payload')
  workspaceStoragePrefix('workspace', value.workspaceId)
  const family = value.family === undefined ? 0 : value.family
  if (
    typeof family !== 'number' ||
    !Number.isSafeInteger(family) ||
    family < 0 ||
    family > WORKSPACE_STORAGE_FAMILIES.length
  )
    throw new Error('Invalid workspace storage sweep cursor')
  return { workspaceId: value.workspaceId, family }
}

function isDisposableKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 2048 &&
    !key.startsWith('/') &&
    !key.split('/').includes('..') &&
    !FOREIGN_LIFECYCLE_ROOTS.some((root) => key.startsWith(root))
  )
}

function parseObjectCleanup(value: unknown): ObjectCleanupPayload {
  if (
    !isRecordLike(value) ||
    value.version !== 1 ||
    typeof value.userId !== 'string' ||
    !SAFE_ID.test(value.userId) ||
    !Array.isArray(value.objects) ||
    value.objects.length > OBJECTS_PER_EVENT
  )
    throw new Error('Invalid account storage cleanup payload')
  const objects = value.objects.map((object): StorageObject => {
    if (
      !isRecordLike(object) ||
      typeof object.key !== 'string' ||
      !isDisposableKey(object.key) ||
      typeof object.context !== 'string' ||
      !OBJECT_CONTEXTS.has(object.context)
    )
      throw new Error('Invalid account storage cleanup object')
    return { key: object.key, context: object.context as StorageContext }
  })
  const cursor = value.cursor === undefined ? 0 : value.cursor
  if (
    typeof cursor !== 'number' ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > objects.length
  )
    throw new Error('Invalid account storage cleanup cursor')
  return { userId: value.userId, objects, cursor }
}

/**
 * Keys some surviving row still names. Every row of a deleted workspace or account is gone by
 * the time a sweep runs, so a remaining reference belongs to data that outlived the deletion —
 * a moved knowledge base, a handed-off file, a soft-deleted file elsewhere — and its object stays.
 */
async function findReferencedStorageKeys(keys: readonly string[]): Promise<Set<string>> {
  const referenced = new Set<string>()
  if (keys.length === 0) return referenced
  const list = [...keys]
  const rows = [
    ...(await db
      .select({ key: workspaceFiles.key })
      .from(workspaceFiles)
      .where(inArray(workspaceFiles.key, list))),
    ...(await db
      .select({ key: workspaceFile.key })
      .from(workspaceFile)
      .where(inArray(workspaceFile.key, list))),
    ...(await db
      .select({ key: workspaceFileVersion.key })
      .from(workspaceFileVersion)
      .where(inArray(workspaceFileVersion.key, list))),
    ...(await db
      .select({ key: document.storageKey })
      .from(document)
      .where(inArray(document.storageKey, list))),
    ...(await db
      .select({ key: executionLargeValues.key })
      .from(executionLargeValues)
      .where(inArray(executionLargeValues.key, list))),
  ]
  for (const row of rows) if (row.key) referenced.add(row.key)
  return referenced
}

/**
 * Walks one prefix to its end, deleting every listed object no surviving row references. Cloud
 * listings follow the provider cursor within a run; a local listing restarts from the first key
 * still on disk, so a page made only of kept keys ends the walk rather than looping on it.
 */
async function sweepWorkspacePrefix(
  prefix: string,
  storageContext: StorageContext,
  context: OutboxEventContext
): Promise<{ deleted: number; complete: boolean }> {
  let deleted = 0
  let pageToken: string | undefined
  for (;;) {
    if (deadlineNear(context)) return { deleted, complete: false }
    const page = await listStorageKeyPage(prefix, storageContext, context.signal, pageToken)
    if (page.keys.some((key) => !key.startsWith(prefix)))
      throw new Error('Storage provider returned a key outside the workspace prefix')
    const referenced = await findReferencedStorageKeys(page.keys)
    if (referenced.size > 0)
      logger.warn('Keeping objects a surviving row still references', {
        prefix,
        kept: referenced.size,
      })
    const result = await deleteStorageKeysUnderPrefix(
      prefix,
      storageContext,
      page.keys.filter((key) => !referenced.has(key)),
      context
    )
    deleted += result.deleted
    if (!result.complete) return { deleted, complete: false }
    if (page.done) return { deleted, complete: true }
    if (page.nextPageToken) {
      pageToken = page.nextPageToken
    } else if (result.deleted === 0) {
      logger.error('Workspace storage sweep stopped at a page of referenced objects', { prefix })
      return { deleted, complete: true }
    }
  }
}

/**
 * Deletes a deleted workspace's objects by prefix in each bucket. A workspace row with the same
 * id means the database no longer agrees the workspace is gone (a restore, a point-in-time
 * recovery), so the sweep completes without touching storage.
 */
const sweepWorkspaceStorage: OutboxHandler<unknown> = async (raw, context) => {
  const payload = parseWorkspaceSweep(raw)
  const [existing] = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, payload.workspaceId))
    .limit(1)
  if (existing) {
    logger.error('Refusing to sweep storage for a workspace that exists', {
      workspaceId: payload.workspaceId,
    })
    return
  }
  let progressed = false
  for (let family = payload.family; family < WORKSPACE_STORAGE_FAMILIES.length; family++) {
    const { root, context: storageContext } = WORKSPACE_STORAGE_FAMILIES[family]
    const prefix = workspaceStoragePrefix(root, payload.workspaceId)
    const result = await sweepWorkspacePrefix(prefix, storageContext, context)
    if (result.deleted > 0) progressed = true
    if (!result.complete) {
      return progressed
        ? continueOutboxHandler('Continuing workspace storage sweep')
        : deferOutboxHandler('Workspace storage sweep made no progress before its deadline')
    }
    await context.checkpointPayload({ family: family + 1 })
    progressed = true
  }
}

/**
 * Deletes exact keys recorded by an account deletion. The account reappearing refuses the batch
 * as a whole; a key any surviving row references is kept.
 */
const cleanupAccountObjects: OutboxHandler<unknown> = async (raw, context) => {
  const payload = parseObjectCleanup(raw)
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, payload.userId))
    .limit(1)
  if (existing) {
    logger.error('Refusing to delete storage for an account that exists', {
      userId: payload.userId,
    })
    return
  }
  const pending = payload.objects.slice(payload.cursor)
  const referenced = await findReferencedStorageKeys(pending.map((object) => object.key))
  if (referenced.size > 0)
    logger.warn('Keeping objects a surviving row still references', {
      userId: payload.userId,
      kept: referenced.size,
    })
  for (let index = payload.cursor; index < payload.objects.length; index++) {
    context.signal.throwIfAborted()
    if (index > payload.cursor && deadlineNear(context)) {
      await context.checkpointPayload({ cursor: index })
      return continueOutboxHandler('Continuing account storage cleanup')
    }
    const { key, context: storageContext } = payload.objects[index]
    if (referenced.has(key)) continue
    try {
      await deleteFile({ key, context: storageContext, signal: context.signal })
    } catch (error) {
      if (describeError(error).code !== 'ENOENT') throw error
    }
  }
}

export const accountStorageSweepOutboxHandlers = {
  [ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT]: sweepWorkspaceStorage,
  [ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT]: cleanupAccountObjects,
} satisfies OutboxHandlerRegistry

/** True when `key` sits under one of `workspaceId`'s swept prefixes. */
function coveredByWorkspaceSweep(key: SQLWrapper, workspaceId: SQLWrapper): SQL {
  return sql`(${sql.join(
    WORKSPACE_STORAGE_FAMILIES.map(
      ({ root }) => sql`starts_with(${key}, ${`${root}/`} || ${workspaceId} || '/')`
    ),
    sql` OR `
  )})`
}

interface ObjectRow {
  id: string
  key: string | null
  context: string | null
}

/** Batches recorded objects into delayed cleanup events inside the deletion transaction. */
class ObjectRecorder {
  private recorded = 0
  private skipped = 0
  private capped = false

  constructor(
    private readonly tx: DbTransaction,
    private readonly userId: string,
    private readonly availableAt: Date
  ) {}

  get full(): boolean {
    return this.capped
  }

  async record(rows: readonly ObjectRow[]): Promise<void> {
    const objects: StorageObject[] = []
    for (const row of rows) {
      if (!row.key || !isDisposableKey(row.key)) continue
      if (!row.context || !OBJECT_CONTEXTS.has(row.context)) {
        this.skipped++
        continue
      }
      if (this.recorded + objects.length >= MAX_DURABLE_OBJECTS) {
        this.capped = true
        break
      }
      objects.push({ key: row.key, context: row.context as StorageContext })
    }
    this.recorded += objects.length
    const payloads = chunkArray(objects, OBJECTS_PER_EVENT).map((chunk) => ({
      version: 1,
      userId: this.userId,
      objects: chunk,
    }))
    for (const batch of chunkArray(payloads, MAX_BULK_ENQUEUE_EVENTS)) {
      await enqueueOutboxEvents(this.tx, ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT, batch, {
        availableAt: this.availableAt,
      })
    }
  }

  summary() {
    return { recorded: this.recorded, skippedContexts: this.skipped, capped: this.capped }
  }
}

async function recordPages(
  recorder: ObjectRecorder,
  page: (afterId: string) => Promise<ObjectRow[]>,
  afterPage?: (rows: ObjectRow[]) => Promise<void>
): Promise<void> {
  let afterId = ''
  while (!recorder.full) {
    const rows = await page(afterId)
    if (rows.length === 0) return
    await recorder.record(rows)
    if (afterPage) await afterPage(rows)
    if (rows.length < ROW_PAGE_SIZE) return
    afterId = rows[rows.length - 1].id
  }
}

async function recordVersionsOf(
  tx: DbTransaction,
  recorder: ObjectRecorder,
  files: readonly ObjectRow[]
): Promise<void> {
  if (files.length === 0 || recorder.full) return
  const contexts = new Map(files.map((file) => [file.id, file.context]))
  const versions = await tx
    .select({
      id: workspaceFileVersion.id,
      key: workspaceFileVersion.key,
      fileId: workspaceFileVersion.fileId,
    })
    .from(workspaceFileVersion)
    .where(
      inArray(
        workspaceFileVersion.fileId,
        files.map((file) => file.id)
      )
    )
  await recorder.record(
    versions.map((version) => ({
      id: version.id,
      key: version.key,
      context: contexts.get(version.fileId) ?? null,
    }))
  )
}

/**
 * Queues the durable storage cleanup for an account deletion, inside its transaction and after
 * the workspace rows are locked, so the work commits or rolls back with the deletion and no row
 * can join a doomed workspace unseen. Takes no locks of its own.
 *
 * - One prefix sweep per deleted workspace, covering every object under its keyed families
 *   whether or not a row ever named it.
 * - Exact keys for the rest of what cascades away: objects in deleted workspaces outside those
 *   prefixes (knowledge-base documents, Copilot uploads), and the account's private files
 *   elsewhere — chat attachments of its own chats, private contexts, and files with no
 *   workspace. Files handed to a successor, Project files, organization files, and attachments
 *   of somebody else's chat are never queued.
 *
 * Both wait out every upload URL signed before the deletion, and both re-check at run time that
 * the owner is still gone and that no surviving row references a key before deleting it.
 */
export async function enqueueAccountStorageCleanupInTx(
  tx: DbTransaction,
  params: { userId: string; workspaceIds: readonly string[] }
): Promise<void> {
  const { userId } = params
  const availableAt = storageCleanupAvailableAt()
  const workspaceIds = params.workspaceIds.filter((id) => SAFE_ID.test(id))
  if (workspaceIds.length !== params.workspaceIds.length) {
    logger.error('Skipping storage sweeps for workspaces with unsafe ids', {
      userId,
      skipped: params.workspaceIds.length - workspaceIds.length,
    })
  }
  for (const batch of chunkArray(workspaceIds, MAX_BULK_ENQUEUE_EVENTS)) {
    await enqueueOutboxEvents(
      tx,
      ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT,
      batch.map((workspaceId) => ({ version: 1, workspaceId })),
      { availableAt }
    )
  }

  const recorder = new ObjectRecorder(tx, userId, availableAt)
  if (workspaceIds.length > 0) {
    await recordPages(recorder, (afterId) =>
      tx
        .select({ id: workspaceFiles.id, key: workspaceFiles.key, context: workspaceFiles.context })
        .from(workspaceFiles)
        .where(
          and(
            inArray(workspaceFiles.workspaceId, workspaceIds),
            isNull(workspaceFiles.projectId),
            sql`NOT ${coveredByWorkspaceSweep(workspaceFiles.key, workspaceFiles.workspaceId)}`,
            gt(workspaceFiles.id, afterId)
          )
        )
        .orderBy(workspaceFiles.id)
        .limit(ROW_PAGE_SIZE)
    )
    await recordPages(recorder, (afterId) =>
      tx
        .select({
          id: workspaceFileVersion.id,
          key: workspaceFileVersion.key,
          context: workspaceFiles.context,
        })
        .from(workspaceFileVersion)
        .innerJoin(workspaceFiles, eq(workspaceFiles.id, workspaceFileVersion.fileId))
        .where(
          and(
            inArray(workspaceFileVersion.workspaceId, workspaceIds),
            isNull(workspaceFiles.projectId),
            sql`NOT ${coveredByWorkspaceSweep(workspaceFileVersion.key, workspaceFileVersion.workspaceId)}`,
            gt(workspaceFileVersion.id, afterId)
          )
        )
        .orderBy(workspaceFileVersion.id)
        .limit(ROW_PAGE_SIZE)
    )
    await recordPages(recorder, (afterId) =>
      tx
        .select({ id: workspaceFile.id, key: workspaceFile.key, context: sql<string>`'workspace'` })
        .from(workspaceFile)
        .where(
          and(
            inArray(workspaceFile.workspaceId, workspaceIds),
            sql`NOT ${coveredByWorkspaceSweep(workspaceFile.key, workspaceFile.workspaceId)}`,
            gt(workspaceFile.id, afterId)
          )
        )
        .orderBy(workspaceFile.id)
        .limit(ROW_PAGE_SIZE)
    )
    await recordPages(recorder, (afterId) =>
      tx
        .select({
          id: document.id,
          key: document.storageKey,
          context: sql<string>`'knowledge-base'`,
        })
        .from(document)
        .innerJoin(knowledgeBase, eq(knowledgeBase.id, document.knowledgeBaseId))
        .where(
          and(
            inArray(knowledgeBase.workspaceId, workspaceIds),
            isNotNull(document.storageKey),
            sql`NOT ${coveredByWorkspaceSweep(document.storageKey, knowledgeBase.workspaceId)}`,
            gt(document.id, afterId)
          )
        )
        .orderBy(document.id)
        .limit(ROW_PAGE_SIZE)
    )
  }

  await recordPages(
    recorder,
    (afterId) =>
      tx
        .select({ id: workspaceFiles.id, key: workspaceFiles.key, context: workspaceFiles.context })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.userId, userId),
            isNull(workspaceFiles.projectId),
            isNull(workspaceFiles.organizationId),
            workspaceIds.length > 0
              ? or(
                  isNull(workspaceFiles.workspaceId),
                  notInArray(workspaceFiles.workspaceId, workspaceIds)
                )
              : undefined,
            or(
              and(
                isNull(workspaceFiles.chatId),
                or(
                  isNull(workspaceFiles.workspaceId),
                  notInArray(workspaceFiles.context, [...HANDED_OFF_FILE_CONTEXTS])
                )
              ),
              inArray(
                workspaceFiles.chatId,
                tx
                  .select({ id: copilotChats.id })
                  .from(copilotChats)
                  .where(eq(copilotChats.userId, userId))
              )
            ),
            gt(workspaceFiles.id, afterId)
          )
        )
        .orderBy(workspaceFiles.id)
        .limit(ROW_PAGE_SIZE),
    (files) => recordVersionsOf(tx, recorder, files)
  )

  const summary = recorder.summary()
  if (summary.capped) {
    logger.error('Account storage cleanup hit its key ceiling; the remainder is left', {
      userId,
      cap: MAX_DURABLE_OBJECTS,
    })
  }
  logger.info('Queued account storage cleanup', {
    userId,
    workspaceSweeps: workspaceIds.length,
    ...summary,
  })
}
