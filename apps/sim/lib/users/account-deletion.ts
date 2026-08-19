import { db } from '@sim/db'
import {
  dataDrains,
  document,
  knowledgeBase,
  member,
  organization,
  permissions,
  user,
  workspaceFile,
  workspaceFiles,
  workspace as workspaceTable,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { formatQuotedNameList } from '@sim/utils/string'
import { and, eq, gt, inArray, isNotNull, ne, notExists, or, sql } from 'drizzle-orm'
import type {
  AccountDeletionBlocker,
  AccountDeletionPlan,
  AccountDeletionResource,
} from '@/lib/api/contracts/user'
import { getHighestPriorityPersonalSubscription } from '@/lib/billing/core/plan'
import { isSoleOwnerOfPaidOrganization } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { StorageContext } from '@/lib/uploads'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'
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
 * Turns the gathered facts into the full picture of an account deletion: what it
 * removes, what it hands off, and every reason it would be refused.
 *
 * The governing rule is that an account is erased only once it stands alone.
 * Nearly every table that points at `user.id` does so with `ON DELETE CASCADE`,
 * and those cascades do not distinguish a workflow in the account's own workspace
 * from a knowledge base it happened to create inside somebody else's — both would
 * go. Rather than chase that blast radius across every creator column (and
 * silently lose whichever one is added next), deletion refuses while the account
 * is still entangled and names the existing action that untangles it: leave the
 * workspace, leave the organization, cancel the plan. Each of those already hands
 * the account's content to a surviving member on its own well-tested path.
 *
 * What remains is provably private, so a workspace falls into exactly one bucket:
 *  - **delete** — nobody else can reach it, so it is erased with the account.
 *  - **transfer** — the account only pays for it or is recorded as its owner
 *    while holding no access to it, so moving that anchor to a real admin
 *    changes nothing anyone can see.
 *  - **blocked** — anything else.
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

  return classifyAccountDeletion({
    workspaces,
    company: await loadWorkspaceCompany(userId, workspaces),
    organizationNames,
    paidOrganizationName: paidOrgCheck.isBlocker
      ? (paidOrgCheck.organizationName ?? 'a paid organization')
      : null,
    personalPlan: personalSubscription?.plan ?? null,
    hasDataDrains: drains.length > 0,
  })
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
 * Collects every stored object held by workspaces that go with the account.
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
async function purgeStorageObjects(batches: StorageKeyBatch[]): Promise<void> {
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
    } catch (error) {
      logger.error('Storage batch deletion failed during account deletion', { context, error })
    }
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
 * account bills for must be handed over or gone before the `user` row is touched.
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

  await db.transaction(async (tx) => {
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

    await tx.delete(user).where(eq(user.id, userId))
  })

  await purgeStorageObjects(storageKeys)

  logger.info('Deleted account', {
    userId,
    workspacesDeleted: doomedWorkspaceIds.length,
    workspacesTransferred: plan.workspacesToTransfer.length,
  })

  return plan
}
