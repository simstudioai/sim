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
  type StorageKeyPage,
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
import { STORAGE_ID_PATTERN, WORKSPACE_STORAGE_FAMILIES } from '@/lib/users/workspace-storage'

const logger = createLogger('AccountStorageSweep')

const ROW_PAGE_SIZE = 1000
const OBJECTS_PER_EVENT = 100
const MAX_PAGE_TOKEN_LENGTH = 4096

/**
 * Runs one workspace sweep may continue on a moved listing position alone. Provider cursors are
 * opaque, so nothing here proves one never revisits a position; past this, a run that only moved
 * its position spends an attempt, keeping the sweep bounded even by a cursor that cycles.
 */
const MAX_POSITION_RESUMES = 1000

/**
 * Ceiling on exact keys one deletion records for durable cleanup. Past it the rest are logged
 * and left; the workspace prefix sweeps are unaffected, since they list storage instead.
 */
const MAX_DURABLE_OBJECTS = 100_000

const OBJECT_CONTEXTS: ReadonlySet<string> = new Set<StorageContext>([
  'workspace',
  'mothership',
  'copilot',
  'chat',
  'knowledge-base',
  'execution',
  'table-import',
  'knowledge-import',
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

interface StorageObject {
  key: string
  context: StorageContext
}

interface WorkspaceSweepPayload {
  workspaceId: string
  family: number
  /** Listing position inside `family` a stopped run saved; absent from events queued before it. */
  pageToken?: string
  /** Runs continued on a moved listing position alone; see {@link MAX_POSITION_RESUMES}. */
  resumes: number
  /**
   * Set once listing from `pageToken` failed. A second failure from the same token restarts the
   * family; a single one is retried in place, since providers do not reliably mark a dead cursor.
   */
  tokenFailed: boolean
}

interface ObjectCleanupPayload {
  userId: string
  objects: StorageObject[]
  cursor: number
}

/** The trailing slash keeps `workspace/ws1/` from matching `workspace/ws10/...`. */
function workspaceStoragePrefix(root: string, workspaceId: string): string {
  if (!STORAGE_ID_PATTERN.test(workspaceId)) throw new Error('Invalid workspace storage identity')
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
  const pageToken = value.pageToken ?? undefined
  if (
    pageToken !== undefined &&
    (typeof pageToken !== 'string' ||
      pageToken.length === 0 ||
      pageToken.length > MAX_PAGE_TOKEN_LENGTH)
  )
    throw new Error('Invalid workspace storage sweep page token')
  const resumes = value.resumes ?? 0
  if (typeof resumes !== 'number' || !Number.isSafeInteger(resumes) || resumes < 0)
    throw new Error('Invalid workspace storage sweep resume count')
  const tokenFailures = value.tokenFailures ?? 0
  if (tokenFailures !== 0 && tokenFailures !== 1)
    throw new Error('Invalid workspace storage sweep page token failure count')
  return {
    workspaceId: value.workspaceId,
    family,
    resumes,
    tokenFailed: tokenFailures === 1,
    ...(pageToken ? { pageToken } : {}),
  }
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
 * The account's avatar, as a storage key. `user.image` holds either a `/api/files/serve/...` path
 * (an upload this app owns) or an absolute URL from an OAuth provider, which must not be deleted;
 * only the former yields a key, and only under `profile-pictures/`. The image is personal data, so
 * an erasure that leaves it in the bucket is not an erasure. `user.image` is user-settable, so the
 * key can name someone else's avatar; the cleanup's reference guard keeps any key another
 * account's `user.image` or a stored asset URL still names.
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
    !STORAGE_ID_PATTERN.test(value.userId) ||
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

/** A local sidecar belongs to its object: it is kept exactly when the object is. */
function sidecarOwner(key: string): string | null {
  return key.endsWith(LOCAL_UPLOAD_METADATA_SUFFIX)
    ? key.slice(0, -LOCAL_UPLOAD_METADATA_SUFFIX.length)
    : null
}

interface PrefixSweepResult {
  deleted: number
  status: 'done' | 'partial' | 'stalled' | 'refused'
  /** On `partial`, the listing position the next run resumes from; absent means the start. */
  pageToken?: string
  /** The saved position could not be listed from, so this run walked from the start instead. */
  restarted: boolean
}

/**
 * Walks one prefix to its end from `startToken`, deleting every listed object the reference guard
 * does not keep, following the listing's page token so kept objects never hold back later ones. A
 * page that neither advances the token nor removes anything is `stalled` rather than re-listed
 * forever. A saved token is provider-specific and may no longer list (an expired or rejected
 * cursor). The first failed listing from one is recorded and rethrown, so the outbox retries from
 * the same position; when that token has failed before, the walk restarts from the prefix start.
 */
async function sweepWorkspacePrefix(
  prefix: string,
  storageContext: StorageContext,
  context: OutboxEventContext,
  isReferenced: (keys: readonly string[]) => Promise<Set<string>>,
  workspaceExists: () => Promise<boolean>,
  startToken: string | undefined,
  startTokenFailed: boolean
): Promise<PrefixSweepResult> {
  let deleted = 0
  let pageToken = startToken
  let restarted = false
  let failureRecorded = startTokenFailed
  for (;;) {
    if (outboxDeadlineNear(context)) return { deleted, status: 'partial', pageToken, restarted }
    let page: StorageKeyPage
    try {
      page = await listStorageKeyPage(prefix, storageContext, context.signal, pageToken)
    } catch (error) {
      if (pageToken === undefined || pageToken !== startToken || restarted) throw error
      context.signal.throwIfAborted()
      if (!failureRecorded) {
        await context.checkpointPayload({ tokenFailures: 1 })
        throw error
      }
      logger.warn('Workspace storage sweep could not resume its saved listing position', {
        prefix,
        error: describeError(error),
      })
      restarted = true
      pageToken = undefined
      continue
    }
    if (failureRecorded) {
      await context.checkpointPayload({ tokenFailures: 0 })
      failureRecorded = false
    }
    if (page.keys.some((key) => !key.startsWith(prefix)))
      throw new Error('Storage provider returned a key outside the workspace prefix')
    const owners = page.keys.flatMap((key) => sidecarOwner(key) ?? [])
    const referenced = await isReferenced([...page.keys, ...owners])
    const kept = (key: string) => referenced.has(key) || referenced.has(sidecarOwner(key) ?? key)
    const keptCount = page.keys.filter(kept).length
    if (keptCount > 0)
      logger.warn('Keeping objects a surviving reference still names', { prefix, kept: keptCount })
    if (await workspaceExists()) return { deleted, status: 'refused', restarted }
    const result = await deleteStorageKeysUnderPrefix(
      prefix,
      storageContext,
      page.keys.filter((key) => !kept(key)),
      context
    )
    deleted += result.deleted
    if (!result.complete) return { deleted, status: 'partial', pageToken, restarted }
    if (page.done) return { deleted, status: 'done', restarted }
    const advanced = page.nextPageToken !== undefined && page.nextPageToken !== pageToken
    if (advanced) {
      pageToken = page.nextPageToken
    } else if (result.deleted === 0) {
      logger.error('Workspace storage sweep made no progress on a full listing page', { prefix })
      return { deleted, status: 'stalled', restarted }
    }
  }
}

/**
 * Deletes a deleted workspace's objects by prefix in each bucket. A workspace row with the same
 * id means the database no longer agrees the workspace is gone (a restore, a point-in-time
 * recovery), so the sweep stops without touching storage; it looks again before every page it
 * deletes from. A run stopped by its deadline saves its listing position, so a family whose early
 * pages are all kept still reaches the objects behind them; moving that position counts as
 * progress, except after a restart from the start or past {@link MAX_POSITION_RESUMES}, so a
 * cursor that never lists or never ends stays bounded by the attempt budget.
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
    const startToken = family === payload.family ? payload.pageToken : undefined
    const result = await sweepWorkspacePrefix(
      prefix,
      storageContext,
      context,
      isReferenced,
      workspaceExists,
      startToken,
      family === payload.family && payload.tokenFailed
    )
    if (result.status === 'refused') return
    if (result.deleted > 0) progressed = true
    if (result.status === 'stalled')
      return deferOutboxHandler('Workspace storage sweep made no progress on a full listing page')
    if (result.status === 'partial') {
      if (result.pageToken !== startToken) {
        const movedOnly = !progressed && !result.restarted
        const resumes = payload.resumes + (movedOnly ? 1 : 0)
        await context.checkpointPayload({ family, pageToken: result.pageToken ?? null, resumes })
        if (movedOnly && resumes <= MAX_POSITION_RESUMES) progressed = true
      }
      return progressed
        ? continueOutboxHandler('Continuing workspace storage sweep')
        : deferOutboxHandler('Workspace storage sweep made no progress before its deadline')
    }
    await context.checkpointPayload({ family: family + 1, pageToken: null })
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
  const referenced = await createStorageReferenceGuard()(pending)
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
    if (!isSafeKey(key) || !isAccountProfilePicture(key, 'profile-pictures') || this.seen.has(key))
      return
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
  return workspaceIds.filter((id) => STORAGE_ID_PATTERN.test(id))
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
