import { db } from '@sim/db'
import {
  apiKey,
  dataDrains,
  document,
  knowledgeBase,
  member,
  organization,
  permissions,
  tableRunDispatches,
  uploadSession,
  user,
  workflowMcpServer,
  workspaceFile,
  workspaceFiles,
  workspaceFileVersion,
  workspace as workspaceTable,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { formatQuotedNameList } from '@sim/utils/string'
import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, notExists, or, sql } from 'drizzle-orm'
import type {
  AccountDeletionBlocker,
  AccountDeletionPlan,
  AccountDeletionResource,
} from '@/lib/api/contracts/user'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import {
  acquireOrganizationMutationLock,
  isSoleOwnerOfPaidOrganization,
} from '@/lib/billing/organizations/membership'
import {
  listSharedResourceOrganizationIdsForUser,
  reassignOrganizationSharedResourcesTx,
} from '@/lib/billing/organizations/resource-handoff'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  getProjectAccountDeletionBlockers,
  prepareProjectsForAccountDeletion,
} from '@/lib/projects/account-deletion'
import { appendTableEvent, type TableEvent } from '@/lib/table/events'
import {
  type CancelledCellMarker,
  cancelPendingMarkersForGovernedSubject,
} from '@/lib/table/rows/executions'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
import {
  listSharedResourceWorkspaceIdsForUser,
  reassignSharedResourceOwnershipForWorkspaceMemberRemovalTx,
} from '@/lib/workspaces/resource-handoff'
import {
  reassignBilledAccountForUser,
  reassignOwnedWorkspacesForUser,
} from '@/lib/workspaces/utils'

const logger = createLogger('AccountDeletion')

/**
 * Rows per storage page, and keys per delete call. `StorageService.deleteFiles`
 * chunks internally at S3's 1,000-key `DeleteObjects` limit, so anything smaller
 * just under-fills that call and multiplies round trips.
 */
const STORAGE_PAGE_SIZE = 1000

/**
 * Upper bound on stored-object keys held in memory between the pre-commit
 * collection and the post-commit purge. Beyond this the remainder is left
 * orphaned and logged — leaking objects beats exhausting the process mid-erasure.
 */
const MAX_PURGE_KEYS = 100_000

/** Names listed inline in a blocker sentence before it summarizes the rest. */
const MAX_NAMES_LISTED = 3

/**
 * Refuses a deletion whose preconditions are not met. Classified as a conflict
 * rather than a bad request: the caller asked for something legitimate that
 * their current entanglements do not allow yet, and the shared orchestration
 * policy already renders that as a 409 carrying this message.
 */
export class AccountDeletionBlockedError extends OrchestrationError {
  constructor(readonly blockers: AccountDeletionBlocker[]) {
    super('conflict', blockers[0]?.message ?? 'This account cannot be deleted yet.')
    this.name = 'AccountDeletionBlockedError'
  }
}

export interface WorkspaceRow {
  id: string
  name: string
  organizationId: string | null
}

const WORKSPACE_COLUMNS = {
  id: workspaceTable.id,
  name: workspaceTable.name,
  organizationId: workspaceTable.organizationId,
} as const

/**
 * Loads every workspace the account touches — the ones it anchors as owner or
 * billing account, and the ones it merely has access to.
 *
 * Anchors have to be here because `owner_id` cascades (and would silently take
 * the workspace with it) while `billed_account_user_id` is `NO ACTION` (and fails
 * the statement outright, ahead of that cascade). Plain memberships have to be
 * here for the opposite reason: they impose no constraint at all, yet the
 * account's workflows, knowledge bases and files inside them would cascade away
 * with it.
 */
async function loadRelatedWorkspaces(userId: string): Promise<WorkspaceRow[]> {
  const [anchored, joined] = await Promise.all([
    db
      .select(WORKSPACE_COLUMNS)
      .from(workspaceTable)
      .where(
        or(eq(workspaceTable.ownerId, userId), eq(workspaceTable.billedAccountUserId, userId))
      ),
    db
      .select(WORKSPACE_COLUMNS)
      .from(permissions)
      .innerJoin(workspaceTable, eq(workspaceTable.id, permissions.entityId))
      .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.userId, userId))),
  ])

  const byId = new Map<string, WorkspaceRow>()
  for (const row of [...anchored, ...joined]) byId.set(row.id, row)
  return [...byId.values()]
}

export interface WorkspaceCompany {
  /** Whether anyone other than the departing account holds access to the workspace. */
  hasOtherMembers: boolean
  /** Whether the departing account itself holds access to it. */
  isMember: boolean
  /**
   * Whether some other admin could inherit the billing and ownership anchors.
   * Only the existence matters here — the handover itself is performed by
   * `reassignBilledAccountForUser` / `reassignOwnedWorkspacesForUser`, which
   * resolve the successor themselves.
   */
  hasAdminSuccessor: boolean
}

/**
 * Answers, for each related workspace, who else is in it and whether the
 * departing account is in it at all.
 *
 * Aggregated in Postgres rather than folded in JS: the three facts are booleans,
 * and a workspace with thousands of members would otherwise transfer thousands of
 * rows to compute them. One statement still means the answers cannot be read at
 * different moments.
 */
async function loadWorkspaceCompany(
  userId: string,
  workspaces: WorkspaceRow[]
): Promise<Map<string, WorkspaceCompany>> {
  const company = new Map<string, WorkspaceCompany>()
  if (workspaces.length === 0) return company

  const rows = await db
    .select({
      entityId: permissions.entityId,
      isMember: sql<boolean>`bool_or(${permissions.userId} = ${userId})`,
      hasOtherMembers: sql<boolean>`bool_or(${permissions.userId} <> ${userId})`,
      hasAdminSuccessor: sql<boolean>`coalesce(bool_or(${permissions.userId} <> ${userId} and ${permissions.permissionType} = 'admin'), false)`,
    })
    .from(permissions)
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        inArray(
          permissions.entityId,
          workspaces.map((workspace) => workspace.id)
        )
      )
    )
    .groupBy(permissions.entityId)

  for (const workspace of workspaces) {
    company.set(workspace.id, {
      hasOtherMembers: false,
      isMember: false,
      hasAdminSuccessor: false,
    })
  }
  for (const row of rows) {
    company.set(row.entityId, {
      isMember: Boolean(row.isMember),
      hasOtherMembers: Boolean(row.hasOtherMembers),
      hasAdminSuccessor: Boolean(row.hasAdminSuccessor),
    })
  }

  return company
}

async function loadOrganizationNames(userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))

  return rows.map((row) => row.name)
}

/** Everything the classifier needs, gathered by {@link getAccountDeletionPlan}. */
export interface AccountDeletionFacts {
  /** Every workspace the account anchors or has access to. */
  workspaces: WorkspaceRow[]
  /** Who else is in each of those workspaces, keyed by workspace id. */
  company: Map<string, WorkspaceCompany>
  organizationNames: string[]
  /** The organization the account solely owns on a paid plan, if any. */
  paidOrganizationName: string | null
  /** The account's own paid plan, if it still entitles them. */
  personalPlan: string | null
  hasDataDrains: boolean
}

/**
 * Classifies current memberships and workspace ownership/billing anchors. Shared memberships
 * must be left before erasure; private workspaces are deleted, and orphaned anchors transfer
 * to a surviving administrator. Execution dependencies are checked separately, and the final
 * transaction repairs shared creator references from departures before this policy existed.
 */
export function classifyAccountDeletion(facts: AccountDeletionFacts): AccountDeletionPlan {
  const blockers: AccountDeletionBlocker[] = []
  const workspacesToDelete: AccountDeletionResource[] = []
  const workspacesToTransfer: AccountDeletionResource[] = []
  const sharedWorkspaces: AccountDeletionResource[] = []
  const organizationWorkspaces: AccountDeletionResource[] = []

  if (facts.paidOrganizationName) {
    blockers.push({
      code: 'paid_organization_owner',
      message: `You own ${facts.paidOrganizationName}. Transfer ownership to another member, or cancel the organization’s plan, before deleting your account.`,
    })
  } else if (facts.organizationNames.length > 0) {
    blockers.push({
      code: 'organization_member',
      message: `Leave ${formatNames(facts.organizationNames)} before deleting your account, so your seat is released and your work is handed over.`,
    })
  }

  if (facts.personalPlan) {
    blockers.push({
      code: 'active_subscription',
      message: `Your ${facts.personalPlan} plan is still active. Cancel it in Billing before deleting your account.`,
    })
  }

  if (facts.hasDataDrains) {
    blockers.push({
      code: 'data_drain_owner',
      message:
        'You created one or more data drains that other people still depend on. Ask an organization admin to delete them before deleting your account.',
    })
  }

  for (const workspace of facts.workspaces) {
    const entry = facts.company.get(workspace.id)
    const summary = { id: workspace.id, name: workspace.name }

    if (!entry?.hasOtherMembers) {
      if (workspace.organizationId) organizationWorkspaces.push(summary)
      else workspacesToDelete.push(summary)
    } else if (!entry.isMember && entry.hasAdminSuccessor) {
      workspacesToTransfer.push(summary)
    } else {
      sharedWorkspaces.push(summary)
    }
  }

  if (organizationWorkspaces.length > 0) {
    const [belongs, theyAre, them] =
      organizationWorkspaces.length === 1
        ? (['belongs', 'it is', 'it'] as const)
        : (['belong', 'they are', 'them'] as const)
    blockers.push({
      code: 'organization_workspace',
      message: `${formatResourceNames(organizationWorkspaces)} ${belongs} to an organization, whose storage and billing ${theyAre} part of. Ask an organization admin to take ${them} over or delete ${them} before deleting your account.`,
    })
  }

  if (sharedWorkspaces.length > 0) {
    const them = sharedWorkspaces.length === 1 ? 'it' : 'them'
    blockers.push({
      code: 'shared_workspace',
      message: `Leave ${formatResourceNames(sharedWorkspaces)} — or remove everyone else from ${them} — before deleting your account, so nothing of yours that others rely on is deleted with you.`,
    })
  }

  return { blockers, workspacesToDelete, workspacesToTransfer }
}

function formatNames(names: string[]): string {
  return formatQuotedNameList(names, MAX_NAMES_LISTED)
}

function formatResourceNames(resources: AccountDeletionResource[]): string {
  return formatNames(resources.map((resource) => resource.name))
}

/** Public MCP actors and live shared keys cannot acquire a new identity through attribution handoff. */
async function sharedExecutionDeletionBlockers(
  executor: DbOrTx,
  userId: string,
  doomedWorkspaceIds: string[],
  hold = false
): Promise<AccountDeletionBlocker[]> {
  const doomed = new Set(doomedWorkspaceIds)
  const serverQuery = executor
    .select({
      id: workflowMcpServer.id,
      name: workflowMcpServer.name,
      workspaceId: workflowMcpServer.workspaceId,
      isPublic: workflowMcpServer.isPublic,
    })
    .from(workflowMcpServer)
    .where(eq(workflowMcpServer.createdBy, userId))
  const servers = await (hold ? serverQuery.for('update') : serverQuery)
  const keyQuery = executor
    .select({
      id: apiKey.id,
      name: apiKey.name,
      workspaceId: apiKey.workspaceId,
      expiresAt: apiKey.expiresAt,
    })
    .from(apiKey)
    .where(and(eq(apiKey.userId, userId), eq(apiKey.type, 'workspace')))
  const keys = await (hold ? keyQuery.for('update') : keyQuery)
  const retainedServers = servers.filter((row) => row.isPublic && !doomed.has(row.workspaceId))
  const liveKeys = keys.filter(
    (row) =>
      row.workspaceId &&
      !doomed.has(row.workspaceId) &&
      (!row.expiresAt || row.expiresAt > new Date())
  )
  const blockers: AccountDeletionBlocker[] = []
  if (retainedServers.length)
    blockers.push({
      code: 'shared_workspace',
      message: `Public MCP servers ${formatResourceNames(retainedServers)} still use your account to execute. Ask a workspace admin to delete them or make them private before deleting your account. Restore an archived workspace first if needed.`,
    })
  if (liveKeys.length)
    blockers.push({
      code: 'shared_workspace',
      message: `Workspace API keys ${formatResourceNames(liveKeys)} still depend on your account. Ask a workspace admin to replace and revoke them in Settings before deleting your account.`,
    })
  return blockers
}

/** Gathers the facts above and classifies them. */
export async function getAccountDeletionPlan(userId: string): Promise<AccountDeletionPlan> {
  const [workspaces, organizationNames, paidOrgCheck, personalSubscription, drains] =
    await Promise.all([
      loadRelatedWorkspaces(userId),
      loadOrganizationNames(userId),
      isSoleOwnerOfPaidOrganization(userId),
      /**
       * `onError: 'throw'` rather than the default `'return-null'`: a failed
       * subscription read would otherwise read as "no plan", skipping the
       * blocker and erasing an account Stripe is still billing.
       */
      getHighestPriorityPersonalSubscription(userId, { onError: 'throw' }),
      db
        .select({ id: dataDrains.id })
        .from(dataDrains)
        .where(eq(dataDrains.createdBy, userId))
        .limit(1),
    ])

  const plan = classifyAccountDeletion({
    workspaces,
    company: await loadWorkspaceCompany(userId, workspaces),
    organizationNames,
    paidOrganizationName: paidOrgCheck.isBlocker
      ? (paidOrgCheck.organizationName ?? 'a paid organization')
      : null,
    personalPlan: personalSubscription?.plan ?? null,
    hasDataDrains: drains.length > 0,
  })
  const projectBlockers = await getProjectAccountDeletionBlockers(
    userId,
    plan.workspacesToDelete.map((row) => row.id)
  )
  plan.blockers.push(
    ...projectBlockers.map((message) => ({ code: 'project_lifecycle' as const, message }))
  )
  plan.blockers.push(
    ...(await sharedExecutionDeletionBlockers(
      db,
      userId,
      plan.workspacesToDelete.map((row) => row.id)
    ))
  )
  return plan
}

interface StorageKeyRow {
  id: string
  key: string | null
  /** Set only by the multi-context table, whose rows carry their own context. */
  context?: string | null
}

/** One page of keys destined for a single storage context. */
interface StorageKeyBatch {
  context: StorageContext
  keys: string[]
}

/**
 * Walks a table in id order, collecting each page's keys.
 *
 * Keyset paging rather than `OFFSET`, so Postgres never re-scans and discards
 * everything already visited on every subsequent page.
 */
async function collectPages(
  page: (afterId: string) => Promise<StorageKeyRow[]>,
  into: StorageKeyBatch[],
  contextFor: (row: StorageKeyRow) => StorageContext
): Promise<void> {
  let afterId = ''
  for (;;) {
    if (countKeys(into) >= MAX_PURGE_KEYS) {
      logger.error('Account deletion hit the storage purge cap; the remainder is orphaned', {
        cap: MAX_PURGE_KEYS,
      })
      return
    }

    const rows = await page(afterId)
    if (rows.length === 0) return

    const keysByContext = new Map<StorageContext, string[]>()
    for (const row of rows) {
      if (!row.key) continue
      const context = contextFor(row)
      const bucket = keysByContext.get(context)
      if (bucket) bucket.push(row.key)
      else keysByContext.set(context, [row.key])
    }
    for (const [context, keys] of keysByContext) into.push({ context, keys })

    if (rows.length < STORAGE_PAGE_SIZE) return
    afterId = rows[rows.length - 1].id
  }
}

function countKeys(batches: StorageKeyBatch[]): number {
  let total = 0
  for (const batch of batches) total += batch.keys.length
  return total
}

/**
 * The account's own uploaded avatar, as a storage key.
 *
 * `user.image` holds either a `/api/files/serve/...` path (an upload we own) or
 * an absolute URL from an OAuth provider (which we must not try to delete). Only
 * the former yields a key, and only under the `profile-pictures/` prefix — the
 * image is personal data, so an erasure that leaves it in the bucket is not an
 * erasure.
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

/**
 * Collects the account's private images and stored objects in workspaces that go with it.
 *
 * This has to run *before* the rows are deleted: they disappear with the
 * workspace through `ON DELETE CASCADE`, and the retention sweep that normally
 * reclaims storage is driven entirely by those rows — once they are gone it has
 * no way to find the objects. The keys are held in memory only between this call
 * and the purge that follows the commit; collection stops at `MAX_PURGE_KEYS`, so
 * an oversized account leaks objects rather than exhausting the process.
 */
async function collectAccountStorageKeys(
  userId: string,
  workspaceIds: string[]
): Promise<StorageKeyBatch[]> {
  const batches: StorageKeyBatch[] = []

  await collectPages(
    (afterId) =>
      db
        .select({ id: uploadSession.id, key: uploadSession.finalKey })
        .from(uploadSession)
        .where(
          and(
            eq(uploadSession.userId, userId),
            eq(uploadSession.purpose, 'mothership_attachment'),
            isNull(uploadSession.workspaceId),
            eq(uploadSession.status, 'completed'),
            gt(uploadSession.id, afterId)
          )
        )
        .orderBy(uploadSession.id)
        .limit(STORAGE_PAGE_SIZE),
    batches,
    () => 'mothership'
  )

  if (!isUsingCloudStorage()) return batches

  const [profile] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const profilePictureKey = extractProfilePictureKey(profile?.image ?? null)
  if (profilePictureKey) {
    batches.push({ context: 'profile-pictures', keys: [profilePictureKey] })
  }

  if (workspaceIds.length === 0) return batches

  await collectPages(
    (afterId) =>
      db
        .select({ id: workspaceFile.id, key: workspaceFile.key })
        .from(workspaceFile)
        .where(and(inArray(workspaceFile.workspaceId, workspaceIds), gt(workspaceFile.id, afterId)))
        .orderBy(workspaceFile.id)
        .limit(STORAGE_PAGE_SIZE),
    batches,
    () => 'workspace'
  )

  await collectPages(
    (afterId) =>
      db
        .select({ id: workspaceFiles.id, key: workspaceFiles.key, context: workspaceFiles.context })
        .from(workspaceFiles)
        .where(
          and(inArray(workspaceFiles.workspaceId, workspaceIds), gt(workspaceFiles.id, afterId))
        )
        .orderBy(workspaceFiles.id)
        .limit(STORAGE_PAGE_SIZE),
    batches,
    (row) => (row.context as StorageContext | null) ?? 'workspace'
  )

  await collectPages(
    (afterId) =>
      db
        .select({ id: workspaceFileVersion.id, key: workspaceFileVersion.key })
        .from(workspaceFileVersion)
        .where(
          and(
            inArray(workspaceFileVersion.workspaceId, workspaceIds),
            gt(workspaceFileVersion.id, afterId)
          )
        )
        .orderBy(workspaceFileVersion.id)
        .limit(STORAGE_PAGE_SIZE),
    batches,
    () => 'workspace'
  )

  await collectPages(
    (afterId) =>
      db
        .select({ id: document.id, key: document.storageKey })
        .from(document)
        .innerJoin(knowledgeBase, eq(knowledgeBase.id, document.knowledgeBaseId))
        .where(
          and(
            inArray(knowledgeBase.workspaceId, workspaceIds),
            isNotNull(document.storageKey),
            gt(document.id, afterId)
          )
        )
        .orderBy(document.id)
        .limit(STORAGE_PAGE_SIZE),
    batches,
    () => 'knowledge-base'
  )

  return batches
}

/**
 * Erases stored objects. A storage failure is logged but never rethrown: by the
 * time this runs the account is already gone, and the request must not report a
 * failure for work that cannot be undone. An orphaned object is recoverable from
 * the log; a deletion the caller believes failed is not.
 */
async function purgeStorageObjects(userId: string, batches: StorageKeyBatch[]): Promise<void> {
  for (const { context, keys } of batches) {
    if (keys.length === 0) continue
    try {
      const { failed } = await StorageService.deleteFiles(keys, context)
      for (const { key, error } of failed) {
        logger.error('Failed to erase stored object during account deletion', {
          key,
          context,
          error,
        })
      }

      if (context === 'mothership') {
        const failedKeys = new Set(failed.map(({ key }) => key))
        const deletedImageKeys = keys.filter(
          (key) => key.startsWith('assistant/') && !failedKeys.has(key)
        )
        if (deletedImageKeys.length > 0) {
          /**
           * Keep ownership records while a signed PUT can recreate the object.
           * The upload-session sweep retries these and failed object deletions
           * after the deleted uploader and transfer expiry are confirmed.
           */
          await db
            .delete(uploadSession)
            .where(
              and(
                eq(uploadSession.userId, userId),
                eq(uploadSession.purpose, 'mothership_attachment'),
                isNull(uploadSession.workspaceId),
                eq(uploadSession.status, 'completed'),
                lte(uploadSession.expiresAt, new Date()),
                inArray(uploadSession.finalKey, deletedImageKeys)
              )
            )
        }
      }
    } catch (error) {
      logger.error('Storage cleanup failed during account deletion', { context, error })
    }
  }
}

/** One dispatch the deletion stopped, in the shape its terminal event needs. */
interface CancelledDispatch {
  id: string
  tableId: string
  scope: unknown
  cursor: number
  mode: string
  isManualRun: boolean
}

/**
 * Publishes the terminal events for work the deletion cancelled.
 *
 * The cancels above are direct writes rather than the ordinary cancel path, so
 * nothing had announced them: a collaborator in a surviving workspace kept
 * watching a dispatch that will never advance and cells stuck on their in-flight
 * pill. These are the same two events `markActiveDispatchesCancelled` and the
 * cell writers publish, so the client reconciles exactly as it does for a Stop.
 *
 * After the commit, never inside it: an event announcing a rollback would be a
 * lie, and the SSE log is not transactional. Failures are logged rather than
 * raised — the account is already gone, and the periodic refetch is the backstop.
 */
async function announceCancelledTableWork(
  dispatches: CancelledDispatch[],
  markers: CancelledCellMarker[]
): Promise<void> {
  const events = [
    ...dispatches.map((dispatch) =>
      appendTableEvent({
        kind: 'dispatch' as const,
        tableId: dispatch.tableId,
        dispatchId: dispatch.id,
        status: 'cancelled' as const,
        scope: (dispatch.scope ?? undefined) as Extract<TableEvent, { kind: 'dispatch' }>['scope'],
        cursor: dispatch.cursor,
        mode: dispatch.mode as 'all' | 'incomplete' | 'new',
        isManualRun: dispatch.isManualRun,
      })
    ),
    ...markers.map((marker) =>
      appendTableEvent({
        kind: 'cell' as const,
        tableId: marker.tableId,
        rowId: marker.rowId,
        groupId: marker.groupId,
        status: 'cancelled' as const,
        executionId: null,
        jobId: null,
        error: 'Cancelled',
      })
    ),
  ]
  const results = await Promise.allSettled(events)
  const failed = results.filter((result) => result.status === 'rejected').length
  if (failed > 0) {
    logger.warn('Some cancellation events were not published during account deletion', { failed })
  }
}

/**
 * Erases an account and everything only it can reach.
 *
 * Sequenced so that nothing irreversible happens until the deletion is certain:
 *
 * 1. **Collect the storage keys.** The rows that name them cascade away with the
 *    workspace, and the retention sweep that normally reclaims storage is driven
 *    entirely by those rows — once they are gone it has no way to find the
 *    objects, so the keys must be read while they still exist. Reading is
 *    harmless if the deletion is later refused.
 * 2. **Do the whole teardown in one transaction** — the billing and ownership
 *    handovers, the workspace deletes, and the `user` delete. Any failure rolls
 *    all of it back, so a refused deletion can never leave a workspace
 *    reassigned or removed. Workspaces on their way out are expected to come
 *    back unresolved from the handovers and are filtered against the doomed set
 *    rather than treated as failures.
 * 3. **Purge storage last**, once that transaction has committed. Object
 *    deletion cannot be rolled back, so it must not precede the point of no
 *    return.
 *
 * The ordering inside step 2 is load-bearing too: Postgres evaluates the
 * `NO ACTION` check on `workspace.billed_account_user_id` *before* the `owner_id`
 * cascade that would have removed the very same workspace, so a workspace the
 * account bills for must be handed over or gone before the `user` row is deleted.
 *
 * The plan is recomputed here rather than accepted from the caller: a preview is
 * a display, never an authorization.
 */
export async function deleteUserAccount(userId: string): Promise<AccountDeletionPlan> {
  const plan = await getAccountDeletionPlan(userId)
  if (plan.blockers.length > 0) throw new AccountDeletionBlockedError(plan.blockers)

  const doomedWorkspaceIds = plan.workspacesToDelete.map((workspace) => workspace.id)
  const doomed = new Set(doomedWorkspaceIds)
  const storageKeys = await collectAccountStorageKeys(userId, doomedWorkspaceIds)

  let cancelledDispatches: CancelledDispatch[] = []
  let cancelledMarkers: CancelledCellMarker[] = []

  await db.transaction(async (tx) => {
    /** Blocks new user FK references through retention discovery, run cancellation, and deletion. */
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update')
    const executionBlockers = await sharedExecutionDeletionBlockers(
      tx,
      userId,
      doomedWorkspaceIds,
      true
    )
    if (executionBlockers.length) throw new AccountDeletionBlockedError(executionBlockers)
    await prepareProjectsForAccountDeletion(tx, userId, doomedWorkspaceIds)
    if (doomedWorkspaceIds.length > 0) {
      /**
       * Re-checked here rather than trusted from the plan: a workspace that
       * gained a member since the preview is no longer private, and deleting it
       * would destroy somebody else's work. The guard makes the delete a no-op
       * for that row, and the short count aborts the transaction — including the
       * handovers below — so the account survives to be re-previewed.
       */
      const deleted = await tx
        .delete(workspaceTable)
        .where(
          and(
            inArray(workspaceTable.id, doomedWorkspaceIds),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(permissions)
                .where(
                  and(
                    eq(permissions.entityType, 'workspace'),
                    eq(permissions.entityId, workspaceTable.id),
                    ne(permissions.userId, userId)
                  )
                )
            )
          )
        )
        .returning({ id: workspaceTable.id })

      if (deleted.length !== doomedWorkspaceIds.length) {
        throw new AccountDeletionBlockedError([
          {
            code: 'shared_workspace',
            message:
              'Someone was given access to one of your workspaces while your account was being deleted. Nothing was changed — reopen this dialog to see the difference.',
          },
        ])
      }
    }

    /**
     * Sequential by necessity, not oversight: the billing pass reads `owner_id`
     * while it still names the departing account, and the ownership pass reads
     * the `billed_account_user_id` the billing pass has just rewritten.
     */
    const { unresolved: billingUnresolved } = await reassignBilledAccountForUser(userId, tx)
    const { unresolved: ownershipUnresolved } = await reassignOwnedWorkspacesForUser(userId, tx)
    const stranded = [...billingUnresolved, ...ownershipUnresolved].filter((id) => !doomed.has(id))
    if (stranded.length > 0) {
      throw new AccountDeletionBlockedError([
        {
          code: 'shared_workspace',
          message:
            'A workspace changed while your account was being deleted and can no longer be handed over. Nothing was changed — try again.',
        },
      ])
    }

    const sharedOrganizationIds = await listSharedResourceOrganizationIdsForUser(tx, userId)
    for (const organizationId of sharedOrganizationIds) {
      await acquireOrganizationMutationLock(tx, organizationId)
      await reassignOrganizationSharedResourcesTx(tx, organizationId, userId)
    }

    const sharedWorkspaceIds = await listSharedResourceWorkspaceIdsForUser(tx, userId)
    const { unresolved: resourceUnresolved } =
      await reassignSharedResourceOwnershipForWorkspaceMemberRemovalTx({
        tx,
        workspaceIds: sharedWorkspaceIds,
        departingUserId: userId,
      })
    if (resourceUnresolved.length > 0) {
      throw new AccountDeletionBlockedError([
        {
          code: 'shared_workspace',
          message:
            'Shared resources still reference your account. Ask a workspace admin to assign an active billing account before deleting your account. Nothing was changed.',
        },
      ])
    }

    /**
     * Cancel every table run this account still governs before the `user` row
     * goes away.
     *
     * `capability_governed_user_id` is `ON DELETE SET NULL`, and a nulled
     * subject is indistinguishable from a legitimately actorless run — the
     * worker would read the surviving dispatch as "no acting person, no
     * per-tool gate" and keep executing its remaining windows ungated, for as
     * long as the scope takes (the in-process dispatcher has no time ceiling).
     * `RESTRICT` would trade that for blocking account deletion behind
     * background work, which is the failure mode the billed-account foreign key
     * already demonstrates. Going terminal instead is the honest reading: a
     * deleted person's runs should stop, not silently lose their gate.
     */
    cancelledDispatches = await tx
      .update(tableRunDispatches)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(
        and(
          eq(tableRunDispatches.capabilityGovernedUserId, userId),
          inArray(tableRunDispatches.status, ['pending', 'dispatching'])
        )
      )
      .returning({
        id: tableRunDispatches.id,
        tableId: tableRunDispatches.tableId,
        scope: tableRunDispatches.scope,
        cursor: tableRunDispatches.cursor,
        mode: tableRunDispatches.mode,
        isManualRun: tableRunDispatches.isManualRun,
      })

    /**
     * The dispatch cancel alone leaves the cells it already pre-stamped. Those
     * markers are drained by whoever holds the row's cascade lock, and that
     * worker's guard reads its own dispatch — so an unrelated active dispatch
     * runs the departing account's marker, whose nulled subject then reads as
     * "actorless, no gate". Same transaction as the dispatch cancel: both are
     * the same stop.
     */
    cancelledMarkers = await cancelPendingMarkersForGovernedSubject(tx, userId)

    try {
      await tx.delete(user).where(eq(user.id, userId))
    } catch (error) {
      if (
        getPostgresErrorCode(error) === '23503' &&
        getPostgresConstraintName(error) === 'project_owner_id_user_id_fk'
      ) {
        throw new AccountDeletionBlockedError([
          {
            code: 'project_lifecycle',
            message:
              'A Project changed while your account was being deleted. Nothing was changed — try again.',
          },
        ])
      }
      throw error
    }
  })

  await announceCancelledTableWork(cancelledDispatches, cancelledMarkers)

  await purgeStorageObjects(userId, storageKeys)

  logger.info('Deleted account', {
    userId,
    workspacesDeleted: doomedWorkspaceIds.length,
    workspacesTransferred: plan.workspacesToTransfer.length,
  })

  return plan
}
