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
import { and, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm'
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
      getHighestPriorityPersonalSubscription(userId),
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

/**
 * Walks a table in id order, handing each page to `handle`.
 *
 * Keyset paging rather than `OFFSET`: the caller deletes stored objects but
 * leaves the rows in place for the cascade, so an offset would make Postgres
 * re-scan and discard everything already visited on every page.
 */
async function forEachPage(
  page: (afterId: string) => Promise<StorageKeyRow[]>,
  handle: (rows: StorageKeyRow[]) => Promise<void>
): Promise<void> {
  let afterId = ''
  for (;;) {
    const rows = await page(afterId)
    if (rows.length === 0) return
    await handle(rows)
    if (rows.length < STORAGE_PAGE_SIZE) return
    afterId = rows[rows.length - 1].id
  }
}

/**
 * Erases one batch of stored objects. A storage failure is logged but never
 * aborts the deletion: the account holder asked to be erased, and leaving their
 * identity in place because an object store hiccuped would be the worse outcome.
 * An orphaned object is recoverable from the log; a half-deleted account is not.
 */
async function eraseStorageKeys(context: StorageContext, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    const { failed } = await StorageService.deleteFiles(keys, context)
    for (const { key, error } of failed) {
      logger.error('Failed to erase stored object during account deletion', { key, context, error })
    }
  } catch (error) {
    logger.error('Storage batch deletion failed during account deletion', { context, error })
  }
}

function collectKeys(rows: StorageKeyRow[]): string[] {
  const keys: string[] = []
  for (const row of rows) if (row.key) keys.push(row.key)
  return keys
}

/**
 * Erases the stored objects held by workspaces that go with the account.
 *
 * This has to happen before the rows do. The rows disappear with the workspace
 * through `ON DELETE CASCADE`, and the retention sweep that normally reclaims
 * storage is driven entirely by those rows — once they are gone it has no way to
 * find the objects. Each table is paged and erased a page at a time so an account
 * with a very large library never materializes its whole key set.
 *
 * The tables are drained in sequence rather than concurrently to keep in-flight
 * object-store deletions bounded to one page.
 */
async function purgeWorkspaceStorageObjects(workspaceIds: string[]): Promise<void> {
  if (workspaceIds.length === 0 || !isUsingCloudStorage()) return

  await forEachPage(
    (afterId) =>
      db
        .select({ id: workspaceFile.id, key: workspaceFile.key })
        .from(workspaceFile)
        .where(and(inArray(workspaceFile.workspaceId, workspaceIds), gt(workspaceFile.id, afterId)))
        .orderBy(workspaceFile.id)
        .limit(STORAGE_PAGE_SIZE),
    (rows) => eraseStorageKeys('workspace', collectKeys(rows))
  )

  await forEachPage(
    (afterId) =>
      db
        .select({
          id: workspaceFiles.id,
          key: workspaceFiles.key,
          context: workspaceFiles.context,
        })
        .from(workspaceFiles)
        .where(
          and(inArray(workspaceFiles.workspaceId, workspaceIds), gt(workspaceFiles.id, afterId))
        )
        .orderBy(workspaceFiles.id)
        .limit(STORAGE_PAGE_SIZE),
    async (rows) => {
      const keysByContext = new Map<StorageContext, string[]>()
      for (const row of rows) {
        if (!row.key) continue
        const context = (row.context as StorageContext | null) ?? 'workspace'
        const bucket = keysByContext.get(context)
        if (bucket) bucket.push(row.key)
        else keysByContext.set(context, [row.key])
      }
      for (const [context, keys] of keysByContext) await eraseStorageKeys(context, keys)
    }
  )

  await forEachPage(
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
    (rows) => eraseStorageKeys('knowledge-base', collectKeys(rows))
  )
}

/**
 * Erases an account and everything only it can reach.
 *
 * The order is load-bearing. Postgres evaluates the `NO ACTION` check on
 * `workspace.billed_account_user_id` *before* the `owner_id` cascade that would
 * have removed the very same workspace, so a workspace the account bills for must
 * be gone — or handed to someone else — before the `user` row is touched. Every
 * remaining reference either cascades or is set to null by the schema.
 *
 * The plan is recomputed here rather than accepted from the caller: a preview is
 * a display, never an authorization.
 */
export async function deleteUserAccount(userId: string): Promise<AccountDeletionPlan> {
  const plan = await getAccountDeletionPlan(userId)
  if (plan.blockers.length > 0) throw new AccountDeletionBlockedError(plan.blockers)

  const doomedWorkspaceIds = plan.workspacesToDelete.map((workspace) => workspace.id)

  await purgeWorkspaceStorageObjects(doomedWorkspaceIds)

  if (doomedWorkspaceIds.length > 0) {
    await db.delete(workspaceTable).where(inArray(workspaceTable.id, doomedWorkspaceIds))
  }

  /**
   * Sequential by necessity, not oversight: the billing pass reads `owner_id`
   * while it still names the departing account, and the ownership pass reads the
   * `billed_account_user_id` the billing pass has just rewritten.
   */
  const { unresolved: billingUnresolved } = await reassignBilledAccountForUser(userId)
  const { unresolved: ownershipUnresolved } = await reassignOwnedWorkspacesForUser(userId)
  if (billingUnresolved.length > 0 || ownershipUnresolved.length > 0) {
    throw new AccountDeletionBlockedError([
      {
        code: 'shared_workspace',
        message:
          'A workspace changed while your account was being deleted and can no longer be handed over. Try again.',
      },
    ])
  }

  await db.delete(user).where(eq(user.id, userId))

  logger.info('Deleted account', {
    userId,
    workspacesDeleted: doomedWorkspaceIds.length,
    workspacesTransferred: plan.workspacesToTransfer.length,
  })

  return plan
}
