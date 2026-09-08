import { db } from '@sim/db'
import { permissions, type WorkspaceMode, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { PlatformEvents } from '@/lib/core/telemetry'
import type { DbOrTx } from '@/lib/db/types'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import {
  getWorkspaceInvitePolicy,
  lockWorkspaceCreationContext,
  resolveGoverningPermissionGroupOrganization,
  resolveInviteFlags,
  WORKSPACE_MODE,
} from '@/lib/workspaces/policy'

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
 * permission and optional starter workflow atomically.
 */
export async function createWorkspaceInTransaction(
  tx: DbOrTx,
  {
    userId,
    observedOrganizationId,
    name,
    skipDefaultWorkflow = false,
    organizationId,
    workspaceMode,
    billedAccountUserId,
    governingPermissionGroupOrganizationId,
  }: TransactionalCreateWorkspaceParams
): Promise<CreatedWorkspace> {
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

  await tx.insert(workspace).values({
    id: workspaceId,
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
    await tx.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      folderId: null,
      name: 'default-agent',
      description: 'Your first workflow - start building here!',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
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
    id: workspaceId,
    name,
    ownerId: userId,
    organizationId,
    workspaceMode,
    billedAccountUserId: committedBilledAccountUserId,
    allowPersonalApiKeys: true,
    createdAt: now,
    updatedAt: now,
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

  let created: CreatedWorkspace
  try {
    created = await db.transaction((tx) =>
      createWorkspaceInTransaction(tx, { ...params, governingPermissionGroupOrganizationId })
    )
  } catch (error) {
    logger.error('Failed to create workspace', { userId: params.userId, error })
    throw error
  }

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

/**
 * The same default personal workspace a first visit would create.
 *
 * Runs inside an EXTERNAL transaction (the enterprise owner claim). Both
 * `organizationId` and `observedOrganizationId` are `null` by construction, so
 * no organization governs this creation and the permission-group lock is never
 * taken — which is why this path cannot deadlock against the locks the enclosing
 * transaction already holds.
 */
export async function createDefaultPersonalWorkspaceInTransaction(
  tx: DbOrTx,
  params: { userId: string; userName: string | null | undefined }
): Promise<CreatedWorkspace> {
  const firstName = params.userName?.split(' ')[0] || null
  return createWorkspaceInTransaction(tx, {
    userId: params.userId,
    observedOrganizationId: null,
    name: firstName ? `${firstName}'s Workspace` : 'My Workspace',
    organizationId: null,
    workspaceMode: WORKSPACE_MODE.PERSONAL,
    billedAccountUserId: params.userId,
    governingPermissionGroupOrganizationId: null,
  })
}
