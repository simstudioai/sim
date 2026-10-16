import { db } from '@sim/db'
import {
  copilotChats,
  document,
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
  gte,
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
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import type { StorageContext } from '@/lib/uploads/config'
import {
  deleteStorageKeysUnderPrefix,
  listStorageKeyPage,
  outboxDeadlineNear,
  storageCleanupAvailableAt,
} from '@/lib/uploads/core/prefix-sweep'
import { LOCAL_UPLOAD_METADATA_SUFFIX } from '@/lib/uploads/core/storage-key'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { WORKSPACE_SHARED_FILE_CONTEXTS } from '@/lib/uploads/shared/types'
import { createStorageReferenceGuard } from '@/lib/users/storage-reference-guard'
import {
  ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT,
  ACCOUNT_WORKSPACE_STORAGE_SWEEP_EVENT,
} from '@/lib/users/storage-sweep-events'

const logger = createLogger('AccountStorageSweep')

const ROW_PAGE_SIZE = 1000
const OBJECTS_PER_EVENT = 100

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

const OBJECT_CONTEXTS: ReadonlySet<string> = new Set<StorageContext>([
  'workspace',
  'mothership',
  'copilot',
  'chat',
  'knowledge-base',
  'execution',
  'table-import',
  'workspace-logos',
])

/**
 * Keys no row collected here may name: Project prefix cleanup, the Assistant upload-session
 * sweep, organization logos, and profile pictures — which account deletion takes only from the
 * account's own `user.image` (see {@link extractProfilePictureKey}), because whitelabel logos were
 * once uploaded as `profile-pictures` rows under an admin's account.
 */
const FOREIGN_LIFECYCLE_ROOTS = [
  'project/',
  'assistant/',
  'profile-pictures/',
  'organization-logos/',
] as const

const WORKSPACE_KEYED_ROOTS: ReadonlySet<string> = new Set(
  WORKSPACE_STORAGE_FAMILIES.map(({ root }) => root)
)

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

function isSafeKey(key: string): boolean {
  return (
    key.length > 0 && key.length <= 2048 && !key.startsWith('/') && !key.split('/').includes('..')
  )
}

function isDisposableKey(key: string): boolean {
  return isSafeKey(key) && !FOREIGN_LIFECYCLE_ROOTS.some((root) => key.startsWith(root))
}

function isAccountProfilePicture(key: string, context: string): boolean {
  return context === 'profile-pictures' && key.startsWith('profile-pictures/')
}

/**
 * The account's own uploaded avatar, as a storage key. `user.image` holds either a
 * `/api/files/serve/...` path (an upload this app owns) or an absolute URL from an OAuth provider,
 * which must not be deleted; only the former yields a key, and only under `profile-pictures/`.
 * The image is personal data, so an erasure that leaves it in the bucket is not an erasure.
 */
export function extractProfilePictureKey(image: string | null): string | null {
  if (!image) return null
  try {
    const parsed = new URL(image, 'http://placeholder')
    if (parsed.origin !== 'http://placeholder') return null
    const segments = parsed.pathname.split('/')
    if (segments[1] !== 'api' || segments[2] !== 'files' || segments[3] !== 'serve') return null
    let keySegments = segments.slice(4)
    if (['s3', 'blob', 'gcs'].includes(keySegments[0])) keySegments = keySegments.slice(1)
    const key = decodeURIComponent(keySegments.join('/'))
    return key.startsWith('profile-pictures/') ? key : null
  } catch {
    return null
  }
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
      typeof object.context !== 'string' ||
      !(
        (isDisposableKey(object.key) && OBJECT_CONTEXTS.has(object.context)) ||
        (isSafeKey(object.key) && isAccountProfilePicture(object.key, object.context))
      )
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
 * Exact keys under a workspace-keyed root whose workspace still exists. Such an object stays
 * readable to that workspace's members by key, so an exact-key cleanup never deletes it, even when
 * the row that named it cascaded away with the account. A workspace segment that is not a valid id
 * is kept too.
 */
async function keysUnderLiveWorkspaces(keys: readonly string[]): Promise<Set<string>> {
  const kept = new Set<string>()
  const keysByWorkspace = new Map<string, string[]>()
  for (const key of keys) {
    const [root, workspaceId] = key.split('/')
    if (!WORKSPACE_KEYED_ROOTS.has(root)) continue
    if (!workspaceId || !SAFE_ID.test(workspaceId)) {
      kept.add(key)
      continue
    }
    const workspaceKeys = keysByWorkspace.get(workspaceId)
    if (workspaceKeys) workspaceKeys.push(key)
    else keysByWorkspace.set(workspaceId, [key])
  }
  if (keysByWorkspace.size === 0) return kept
  const live = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(inArray(workspaceTable.id, [...keysByWorkspace.keys()]))
  for (const { id } of live) for (const key of keysByWorkspace.get(id) ?? []) kept.add(key)
  return kept
}

/** A local sidecar belongs to its object: it is kept exactly when the object is. */
function sidecarOwner(key: string): string | null {
  return key.endsWith(LOCAL_UPLOAD_METADATA_SUFFIX)
    ? key.slice(0, -LOCAL_UPLOAD_METADATA_SUFFIX.length)
    : null
}

/**
 * Walks one prefix to its end, deleting every listed object the reference guard does not keep,
 * following the listing's page token within a run so kept objects never hold back later ones. A
 * page that neither advances the token nor removes anything is `stalled` rather than re-listed
 * forever.
 */
async function sweepWorkspacePrefix(
  prefix: string,
  storageContext: StorageContext,
  context: OutboxEventContext,
  isReferenced: (keys: readonly string[]) => Promise<Set<string>>,
  workspaceExists: () => Promise<boolean>
): Promise<{ deleted: number; status: 'done' | 'partial' | 'stalled' | 'refused' }> {
  let deleted = 0
  let pageToken: string | undefined
  for (;;) {
    if (outboxDeadlineNear(context)) return { deleted, status: 'partial' }
    const page = await listStorageKeyPage(prefix, storageContext, context.signal, pageToken)
    if (page.keys.some((key) => !key.startsWith(prefix)))
      throw new Error('Storage provider returned a key outside the workspace prefix')
    const owners = page.keys.flatMap((key) => sidecarOwner(key) ?? [])
    const referenced = await isReferenced([...page.keys, ...owners])
    const kept = (key: string) => referenced.has(key) || referenced.has(sidecarOwner(key) ?? key)
    const keptCount = page.keys.filter(kept).length
    if (keptCount > 0)
      logger.warn('Keeping objects a surviving reference still names', { prefix, kept: keptCount })
    if (await workspaceExists()) return { deleted, status: 'refused' }
    const result = await deleteStorageKeysUnderPrefix(
      prefix,
      storageContext,
      page.keys.filter((key) => !kept(key)),
      context
    )
    deleted += result.deleted
    if (!result.complete) return { deleted, status: 'partial' }
    if (page.done) return { deleted, status: 'done' }
    const advanced = page.nextPageToken !== undefined && page.nextPageToken !== pageToken
    if (advanced) {
      pageToken = page.nextPageToken
    } else if (result.deleted === 0) {
      logger.error('Workspace storage sweep made no progress on a full listing page', { prefix })
      return { deleted, status: 'stalled' }
    }
  }
}

/**
 * Deletes a deleted workspace's objects by prefix in each bucket. A workspace row with the same
 * id means the database no longer agrees the workspace is gone (a restore, a point-in-time
 * recovery), so the sweep stops without touching storage; it looks again before every page it
 * deletes from.
 */
const sweepWorkspaceStorage: OutboxHandler<unknown> = async (raw, context) => {
  const payload = parseWorkspaceSweep(raw)
  const workspaceExists = async () => {
    const [existing] = await db
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, payload.workspaceId))
      .limit(1)
    if (existing)
      logger.error('Refusing to sweep storage for a workspace that exists', {
        workspaceId: payload.workspaceId,
      })
    return Boolean(existing)
  }
  if (await workspaceExists()) return
  const isReferenced = createStorageReferenceGuard()
  let progressed = false
  for (let family = payload.family; family < WORKSPACE_STORAGE_FAMILIES.length; family++) {
    const { root, context: storageContext } = WORKSPACE_STORAGE_FAMILIES[family]
    const prefix = workspaceStoragePrefix(root, payload.workspaceId)
    const result = await sweepWorkspacePrefix(
      prefix,
      storageContext,
      context,
      isReferenced,
      workspaceExists
    )
    if (result.status === 'refused') return
    if (result.deleted > 0) progressed = true
    if (result.status === 'stalled')
      return deferOutboxHandler('Workspace storage sweep made no progress on a full listing page')
    if (result.status === 'partial')
      return progressed
        ? continueOutboxHandler('Continuing workspace storage sweep')
        : deferOutboxHandler('Workspace storage sweep made no progress before its deadline')
    await context.checkpointPayload({ family: family + 1 })
    progressed = true
  }
}

/**
 * Deletes exact keys recorded by an account deletion. The account reappearing refuses the batch
 * as a whole; a key the reference guard keeps, or one under a workspace that still exists, stays.
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
  const pending = payload.objects.slice(payload.cursor).map((object) => object.key)
  const referenced = await keysUnderLiveWorkspaces(pending)
  for (const key of await createStorageReferenceGuard()(pending)) referenced.add(key)
  if (referenced.size > 0)
    logger.warn('Keeping objects a surviving reference still names', {
      userId: payload.userId,
      kept: referenced.size,
    })
  for (let index = payload.cursor; index < payload.objects.length; index++) {
    context.signal.throwIfAborted()
    if (index > payload.cursor && outboxDeadlineNear(context)) {
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

/**
 * How far before its read the pre-transaction collection's in-transaction delta looks back, so
 * clock skew between this host and the database, and an insert whose transaction began earlier,
 * cannot slip between the two reads. Re-reading a row only collects its key once.
 */
const DELTA_LOOKBACK_MS = 5 * 60_000

/**
 * Exact keys an account deletion hands to durable cleanup, bounded by {@link MAX_DURABLE_OBJECTS},
 * and the moment from which the in-transaction delta must look for rows the read missed.
 */
interface AccountStorageObjects {
  readonly objects: readonly StorageObject[]
  readonly skippedContexts: number
  readonly capped: boolean
  readonly since: Date
}

class ObjectCollector implements AccountStorageObjects {
  readonly objects: StorageObject[] = []
  private readonly seen = new Set<string>()
  skippedContexts = 0
  capped = false

  constructor(readonly since: Date) {}

  static from(collected: AccountStorageObjects): ObjectCollector {
    const collector = new ObjectCollector(collected.since)
    collector.skippedContexts = collected.skippedContexts
    collector.capped = collected.capped
    for (const object of collected.objects) collector.push(object)
    return collector
  }

  addProfilePicture(key: string): void {
    if (this.seen.has(key)) return
    if (this.objects.length >= MAX_DURABLE_OBJECTS) {
      this.capped = true
      return
    }
    this.push({ key, context: 'profile-pictures' })
  }

  add(rows: readonly ObjectRow[]): void {
    for (const row of rows) {
      if (!row.key || !isDisposableKey(row.key)) continue
      if (!row.context || !OBJECT_CONTEXTS.has(row.context)) {
        this.skippedContexts++
        continue
      }
      if (this.seen.has(row.key)) continue
      if (this.objects.length >= MAX_DURABLE_OBJECTS) {
        this.capped = true
        return
      }
      this.push({ key: row.key, context: row.context as StorageContext })
    }
  }

  private push(object: StorageObject): void {
    this.seen.add(object.key)
    this.objects.push(object)
  }
}

async function collectPages(
  collector: ObjectCollector,
  page: (afterId: string) => Promise<ObjectRow[]>,
  afterPage?: (rows: ObjectRow[]) => Promise<void>
): Promise<void> {
  let afterId = ''
  while (!collector.capped) {
    const rows = await page(afterId)
    if (rows.length === 0) return
    collector.add(rows)
    if (afterPage) await afterPage(rows)
    if (rows.length < ROW_PAGE_SIZE) return
    afterId = rows[rows.length - 1].id
  }
}

async function collectVersionsOf(
  executor: DbOrTx,
  collector: ObjectCollector,
  files: readonly ObjectRow[]
): Promise<void> {
  if (files.length === 0) return
  const contexts = new Map(files.map((file) => [file.id, file.context]))
  const fileIds = files.map((file) => file.id)
  await collectPages(collector, (afterId) =>
    executor
      .select({
        id: workspaceFileVersion.id,
        key: workspaceFileVersion.key,
        fileId: workspaceFileVersion.fileId,
      })
      .from(workspaceFileVersion)
      .where(
        and(inArray(workspaceFileVersion.fileId, fileIds), gt(workspaceFileVersion.id, afterId))
      )
      .orderBy(workspaceFileVersion.id)
      .limit(ROW_PAGE_SIZE)
      .then((versions) =>
        versions.map((version) => ({
          id: version.id,
          key: version.key,
          context: contexts.get(version.fileId) ?? null,
        }))
      )
  )
}

interface CollectionScope {
  userId: string
  workspaceIds: string[]
  /** Set for the in-transaction delta: only the account's rows written since then. */
  since?: Date
}

/**
 * The exact-key reads behind {@link collectAccountStorageObjects}. With `since`, each read is
 * narrowed to the account's own rows written from then on (`workspace_files.user_id`,
 * `document.uploaded_by`, both indexed), and the doomed workspaces' version and legacy-file
 * tables are skipped: a content write in a workspace stores its bytes under `workspace/<id>/`,
 * which the prefix sweep lists.
 */
async function collectInto(
  executor: DbOrTx,
  collector: ObjectCollector,
  { userId, workspaceIds, since }: CollectionScope
): Promise<void> {
  const [account] = await executor
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const profilePicture = extractProfilePictureKey(account?.image ?? null)
  if (profilePicture) collector.addProfilePicture(profilePicture)

  const filesSince = since
    ? and(eq(workspaceFiles.userId, userId), gte(workspaceFiles.uploadedAt, since))
    : undefined
  if (workspaceIds.length > 0) {
    await collectPages(collector, (afterId) =>
      executor
        .select({ id: workspaceFiles.id, key: workspaceFiles.key, context: workspaceFiles.context })
        .from(workspaceFiles)
        .where(
          and(
            inArray(workspaceFiles.workspaceId, workspaceIds),
            isNull(workspaceFiles.projectId),
            filesSince,
            sql`NOT ${coveredByWorkspaceSweep(workspaceFiles.key, workspaceFiles.workspaceId)}`,
            gt(workspaceFiles.id, afterId)
          )
        )
        .orderBy(workspaceFiles.id)
        .limit(ROW_PAGE_SIZE)
    )
    if (!since) {
      await collectPages(collector, (afterId) =>
        executor
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
      await collectPages(collector, (afterId) =>
        executor
          .select({
            id: workspaceFile.id,
            key: workspaceFile.key,
            context: sql<string>`'workspace'`,
          })
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
    }
    await collectPages(collector, (afterId) =>
      executor
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
            since
              ? and(eq(document.uploadedBy, userId), gte(document.uploadedAt, since))
              : undefined,
            sql`NOT ${coveredByWorkspaceSweep(document.storageKey, knowledgeBase.workspaceId)}`,
            gt(document.id, afterId)
          )
        )
        .orderBy(document.id)
        .limit(ROW_PAGE_SIZE)
    )
  }

  const ownChats = executor
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(eq(copilotChats.userId, userId))
  await collectPages(
    collector,
    (afterId) =>
      executor
        .select({ id: workspaceFiles.id, key: workspaceFiles.key, context: workspaceFiles.context })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.userId, userId),
            filesSince,
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
                isNull(workspaceFiles.workspaceId),
                eq(workspaceFiles.context, 'copilot'),
                or(isNull(workspaceFiles.chatId), inArray(workspaceFiles.chatId, ownChats))
              ),
              and(
                isNotNull(workspaceFiles.workspaceId),
                or(
                  inArray(workspaceFiles.chatId, ownChats),
                  and(
                    isNull(workspaceFiles.chatId),
                    notInArray(workspaceFiles.context, [...WORKSPACE_SHARED_FILE_CONTEXTS])
                  )
                )
              )
            ),
            gt(workspaceFiles.id, afterId)
          )
        )
        .orderBy(workspaceFiles.id)
        .limit(ROW_PAGE_SIZE),
    (files) => collectVersionsOf(executor, collector, files)
  )
}

function sweepableWorkspaceIds(workspaceIds: readonly string[]): string[] {
  return workspaceIds.filter((id) => SAFE_ID.test(id))
}

/**
 * Reads the exact keys an account deletion hands to durable cleanup, before its transaction, so
 * these unbounded keyset reads never run while the deletion holds workspace locks that
 * teammates' writes in shared workspaces wait on. Covers what cascades away outside the
 * workspace prefix sweeps: objects in deleted workspaces outside those prefixes (knowledge-base
 * documents, Copilot uploads), and the account's private files elsewhere — chat attachments of
 * its own chats, private contexts, and Copilot files with no workspace. Files handed to a
 * successor, Project and organization files, attachments of somebody else's chat, profile
 * pictures, and workspace-less rows of any other context (a legacy shared row can lack its
 * workspace) are never collected.
 *
 * A row committed after this read is picked up by the narrow delta
 * {@link enqueueAccountStorageCleanupInTx} reads under the deletion's locks.
 */
export async function collectAccountStorageObjects(params: {
  userId: string
  workspaceIds: readonly string[]
}): Promise<AccountStorageObjects> {
  const collector = new ObjectCollector(new Date(Date.now() - DELTA_LOOKBACK_MS))
  await collectInto(db, collector, {
    userId: params.userId,
    workspaceIds: sweepableWorkspaceIds(params.workspaceIds),
  })
  return collector
}

/**
 * Queues the durable storage cleanup for an account deletion inside its transaction, so the work
 * commits or rolls back with the deletion: one prefix sweep per deleted workspace, covering every
 * object under its keyed families whether or not a row ever named it, and delayed events for the
 * exact keys {@link collectAccountStorageObjects} read beforehand plus a delta of the account's
 * own rows written since. The delta runs after the account row is locked, so no further row
 * naming the account can commit; it reads through the `user_id` and `uploaded_by` indexes and
 * takes no locks of its own.
 *
 * Both wait out every upload URL signed before the deletion and re-check at run time that the
 * owner is still gone and that {@link createStorageReferenceGuard} does not keep the key; the
 * exact-key cleanup also keeps any key under a workspace that still exists.
 */
export async function enqueueAccountStorageCleanupInTx(
  tx: DbTransaction,
  params: { userId: string; workspaceIds: readonly string[]; objects: AccountStorageObjects }
): Promise<void> {
  const { userId } = params
  const availableAt = storageCleanupAvailableAt()
  const workspaceIds = sweepableWorkspaceIds(params.workspaceIds)
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

  const collector = ObjectCollector.from(params.objects)
  const collected = collector.objects.length
  await collectInto(tx, collector, { userId, workspaceIds, since: collector.since })
  if (collector.capped) {
    logger.error('Account storage cleanup hit its key ceiling; the remainder is left', {
      userId,
      cap: MAX_DURABLE_OBJECTS,
    })
  }
  const payloads = chunkArray(collector.objects, OBJECTS_PER_EVENT).map((chunk) => ({
    version: 1,
    userId,
    objects: chunk,
  }))
  for (const batch of chunkArray(payloads, MAX_BULK_ENQUEUE_EVENTS)) {
    await enqueueOutboxEvents(tx, ACCOUNT_STORAGE_OBJECT_CLEANUP_EVENT, batch, { availableAt })
  }
  logger.info('Queued account storage cleanup', {
    userId,
    workspaceSweeps: workspaceIds.length,
    recorded: collector.objects.length,
    fromDelta: collector.objects.length - collected,
    skippedContexts: collector.skippedContexts,
    capped: collector.capped,
  })
}
