import { db } from '@sim/db'
import { permissions, user, type WorkspaceMode, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import { PlatformEvents } from '@/lib/core/telemetry'
import type { DbTransaction } from '@/lib/db/types'
import { createProjectRecord } from '@/lib/projects/membership'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { insertNewWorkflowRow } from '@/lib/workflows/persistence/new-workflow-row'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { listWorkspacesForViewer, type WorkspaceListPayload } from '@/lib/workspaces/list'
import {
  getWorkspaceInvitePolicy,
  lockWorkspaceCreationContext,
  resolveGoverningPermissionGroupOrganization,
  resolveInviteFlags,
  WORKSPACE_MODE,
  WorkspaceCreationContextChangedError,
  WorkspaceOwnerMissingError,
} from '@/lib/workspaces/policy'

/** Creation's foreign keys to `user`; a violation means the acting user's row is gone. */
export const WORKSPACE_USER_FK_CONSTRAINTS = new Set([
  'project_owner_id_user_id_fk',
  'workspace_owner_id_user_id_fk',
  'workspace_billed_account_user_id_user_id_fk',
])

const logger = createLogger('WorkspaceCreate')

export interface CreateWorkspaceParams {
  userId: string
  /** Membership observed by the creation-policy read. */
  observedOrganizationId: string | null
  name: string
  skipDefaultWorkflow?: boolean
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
  /**
   * The governing organization already resolved by
   * {@link getWorkspaceCreationPolicy}, forwarded so the entitlement read is not
   * issued twice in one request. `undefined` means unresolved — a caller that
   * did not go through the preflight omits it and {@link createWorkspace}
   * resolves it — while `null` is the resolved answer "no organization governs
   * this creation".
   */
  governingPermissionGroupOrganizationId?: string | null
}

export interface CreatedWorkspace {
  id: string
  name: string
  ownerId: string
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
  allowPersonalApiKeys: boolean
  createdAt: Date
  updatedAt: Date
}

/** Emits the canonical best-effort workspace-created platform event after commit. */
export function emitWorkspaceCreatedPlatformEvent(params: {
  workspaceId: string
  userId: string
  name: string
}): void {
  try {
    PlatformEvents.workspaceCreated(params)
  } catch {}
}

/** {@link CreateWorkspaceParams} plus the pre-transaction entitlement answer. */
export interface TransactionalCreateWorkspaceParams extends CreateWorkspaceParams {
  /**
   * The organization whose permission-group regime governs this creation, from
   * {@link resolveGoverningPermissionGroupOrganization} (`null` for none).
   * Required rather than optional: the `workspace.create` capability is enforced
   * under that organization's permission-group lock inside this transaction, and
   * a silently-omitted value would skip the gate rather than fail to compile.
   */
  governingPermissionGroupOrganizationId: string | null
}

/**
 * Canonical transaction-enlisted workspace creation primitive.
 *
 * The caller supplies the creation-policy snapshot. This function revalidates
 * that snapshot — including the `workspace.create` capability under the
 * permission-group advisory lock — before inserting the workspace, owner
 * permission, its Project and optional starter workflow atomically. A caller
 * creating an explicit Project names it; otherwise the name derives from the
 * workspace.
 */
export async function createWorkspaceWithProjectInTransaction(
  tx: DbTransaction,
  {
    projectName,
    userId,
    observedOrganizationId,
    name,
    skipDefaultWorkflow = false,
    organizationId,
    workspaceMode,
    billedAccountUserId,
    governingPermissionGroupOrganizationId,
  }: TransactionalCreateWorkspaceParams & { projectName?: string }
): Promise<{ projectId: string; workspace: CreatedWorkspace }> {
  const workspaceId = generateId()
  const workflowId = generateId()
  const now = new Date()
  /** Built before the locks: it takes no arguments, so nothing makes it wait for them. */
  const defaultWorkflowArtifacts = skipDefaultWorkflow ? null : buildDefaultWorkflowArtifacts()
  const lockedCreationContext = await lockWorkspaceCreationContext(tx, {
    userId,
    organizationId,
    observedOrganizationId,
    governingPermissionGroupOrganizationId,
  })
  const committedBilledAccountUserId =
    workspaceMode === WORKSPACE_MODE.ORGANIZATION
      ? lockedCreationContext.billedAccountUserId
      : billedAccountUserId

  const projectId = await createProjectRecord(tx, {
    projectName,
    name,
    organizationId: organizationId ?? null,
    ownerId: userId,
  })

  await tx.insert(workspace).values({
    id: workspaceId,
    projectId,
    name,
    ownerId: userId,
    organizationId,
    workspaceMode,
    billedAccountUserId: committedBilledAccountUserId,
    allowPersonalApiKeys: true,
    createdAt: now,
    updatedAt: now,
  })

  const permissionRows = [
    {
      id: generateId(),
      entityType: 'workspace' as const,
      entityId: workspaceId,
      userId,
      permissionType: 'admin' as const,
      createdAt: now,
      updatedAt: now,
    },
  ]
  if (workspaceMode === WORKSPACE_MODE.ORGANIZATION && committedBilledAccountUserId !== userId) {
    permissionRows.push({
      id: generateId(),
      entityType: 'workspace' as const,
      entityId: workspaceId,
      userId: committedBilledAccountUserId,
      permissionType: 'admin' as const,
      createdAt: now,
      updatedAt: now,
    })
  }
  await tx.insert(permissions).values(permissionRows)

  if (defaultWorkflowArtifacts) {
    await insertNewWorkflowRow(tx, {
      id: workflowId,
      userId,
      workspaceId,
      folderId: null,
      name: 'default-agent',
      description: 'Your first workflow - start building here!',
      now,
    })
    await saveWorkflowToNormalizedTables(
      workflowId,
      defaultWorkflowArtifacts.workflowState,
      {
        /** Actorless: workspace creation seeds a platform-authored starter workflow. */
        workspaceId: null,
        subjectUserId: null,
      },
      tx
    )
  }

  return {
    projectId,
    workspace: {
      id: workspaceId,
      name,
      ownerId: userId,
      organizationId,
      workspaceMode,
      billedAccountUserId: committedBilledAccountUserId,
      allowPersonalApiKeys: true,
      createdAt: now,
      updatedAt: now,
    },
  }
}

export async function createWorkspaceInTransaction(
  tx: DbTransaction,
  params: TransactionalCreateWorkspaceParams
): Promise<CreatedWorkspace> {
  return (await createWorkspaceWithProjectInTransaction(tx, params)).workspace
}

/**
 * Runs a workspace-creating transaction, answering a violation of creation's user foreign keys as
 * {@link WorkspaceOwnerMissingError}: the acting user's row is gone.
 */
async function commitWorkspaceCreation<T>(
  userId: string,
  run: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  try {
    return await db.transaction(run)
  } catch (error) {
    if (
      getPostgresErrorCode(error) === '23503' &&
      WORKSPACE_USER_FK_CONSTRAINTS.has(getPostgresConstraintName(error) ?? '')
    ) {
      logger.warn('Workspace creation raced account deletion', { userId })
      throw new WorkspaceOwnerMissingError(userId)
    }
    logger.error('Failed to create workspace', { userId, error })
    throw error
  }
}

/** Creates a workspace through the canonical lock-and-insert transaction. */
export async function createWorkspace(params: CreateWorkspaceParams) {
  /**
   * Resolved before the transaction opens because the entitlement read it
   * performs cannot run on a transaction executor — see
   * {@link resolveGoverningPermissionGroupOrganization}. The capability itself is
   * enforced inside the transaction, under the permission-group lock. A caller
   * that already holds the creation policy forwards its answer, so the read is
   * issued once per request rather than once per call.
   */
  const governingPermissionGroupOrganizationId =
    params.governingPermissionGroupOrganizationId !== undefined
      ? params.governingPermissionGroupOrganizationId
      : await resolveGoverningPermissionGroupOrganization({
          organizationId: params.organizationId,
          observedOrganizationId: params.observedOrganizationId,
        })

  const created = await commitWorkspaceCreation(params.userId, (tx) =>
    createWorkspaceInTransaction(tx, { ...params, governingPermissionGroupOrganizationId })
  )

  logger.info(
    params.skipDefaultWorkflow
      ? `Created ${params.workspaceMode} workspace ${created.id} for user ${params.userId}`
      : `Created ${params.workspaceMode} workspace ${created.id} with initial workflow for user ${params.userId}`
  )

  emitWorkspaceCreatedPlatformEvent({
    workspaceId: created.id,
    userId: params.userId,
    name: params.name,
  })

  const invitePolicy = await getWorkspaceInvitePolicy({
    organizationId: created.organizationId,
    workspaceMode: created.workspaceMode,
    billedAccountUserId: created.billedAccountUserId,
    ownerId: created.ownerId,
  })
  return {
    ...created,
    role: 'owner' as const,
    permissions: 'admin' as const,
    ...resolveInviteFlags(invitePolicy, created.billedAccountUserId === created.ownerId),
  }
}

function defaultWorkspaceName(userName: string | null | undefined): string {
  const firstName = userName?.split(' ')[0] || null
  return firstName ? `${firstName}'s Workspace` : 'My Workspace'
}

/**
 * The same default personal workspace a first visit would create, in the
 * user's personal organization when they have one.
 *
 * Runs inside an EXTERNAL transaction (the enterprise owner claim). The only
 * organization involved is the user's own personal one, which never carries a
 * permission-group regime, so the permission-group lock is never taken — which
 * is why this path cannot deadlock against the locks the enclosing transaction
 * already holds.
 */
export async function createDefaultPersonalWorkspaceInTransaction(
  tx: DbTransaction,
  params: {
    userId: string
    userName: string | null | undefined
    personalOrganizationId: string | null
  }
): Promise<CreatedWorkspace> {
  return createWorkspaceInTransaction(tx, {
    userId: params.userId,
    observedOrganizationId: params.personalOrganizationId,
    name: defaultWorkspaceName(params.userName),
    organizationId: params.personalOrganizationId,
    workspaceMode: WORKSPACE_MODE.PERSONAL,
    billedAccountUserId: params.userId,
    governingPermissionGroupOrganizationId: null,
  })
}

/** Whether the user holds a permission on a workspace that is not archived. */
async function holdsActiveWorkspace(tx: DbTransaction, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: workspace.id })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        isNull(workspace.archivedAt)
      )
    )
    .limit(1)
  return Boolean(row)
}

/**
 * The viewer's active workspace list, with their default workspace created first when they have
 * none and may create one. Creation is idempotent: under the locks the creation context takes, it
 * checks again for an active workspace, so concurrent first visits (the shell's server render, the
 * client's list read, the `/workspace` entry) create exactly one between them. The new workspace
 * adopts the workflows the user made before workspaces existed. A membership change that races the
 * creation lists the join's workspaces instead.
 */
export async function listWorkspacesEnsuringDefault({
  userId,
  activeOrganizationId,
}: {
  userId: string
  activeOrganizationId: string | null
}): Promise<WorkspaceListPayload> {
  const payload = await listWorkspacesForViewer({ userId, activeOrganizationId, scope: 'active' })
  const { creationPolicy } = payload
  if (payload.workspaces.length > 0 || !creationPolicy.canCreate) return payload
  try {
    const created = await commitWorkspaceCreation(userId, async (tx) => {
      await acquireOrganizationUserMutationLocks(tx, {
        userId,
        organizationIds: creationPolicy.organizationId ? [creationPolicy.organizationId] : [],
      })
      if (await holdsActiveWorkspace(tx, userId)) return null
      const [owner] = await tx
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
      const defaultWorkspace = await createWorkspaceInTransaction(tx, {
        userId,
        name: defaultWorkspaceName(owner?.name),
        organizationId: creationPolicy.organizationId,
        workspaceMode: creationPolicy.workspaceMode,
        billedAccountUserId: creationPolicy.billedAccountUserId,
        observedOrganizationId: creationPolicy.observedOrganizationId,
        governingPermissionGroupOrganizationId:
          creationPolicy.governingPermissionGroupOrganizationId,
      })
      await tx
        .update(workflow)
        .set({ workspaceId: defaultWorkspace.id, updatedAt: new Date() })
        .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))
      return defaultWorkspace
    })
    if (created) {
      logger.info('Created default workspace', { userId, workspaceId: created.id })
      emitWorkspaceCreatedPlatformEvent({ workspaceId: created.id, userId, name: created.name })
    }
  } catch (error) {
    if (!(error instanceof WorkspaceCreationContextChangedError)) throw error
    logger.info('Default workspace creation raced an organization membership change', { userId })
  }
  return listWorkspacesForViewer({ userId, activeOrganizationId, scope: 'active' })
}
