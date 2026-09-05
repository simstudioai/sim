import { db } from '@sim/db'
import { permissions, type WorkspaceMode, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { PlatformEvents } from '@/lib/core/telemetry'
import type { DbOrTx } from '@/lib/db/types'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getRandomWorkspaceColor } from '@/lib/workspaces/colors'
import {
  assertWorkspaceCreationCapability,
  getWorkspaceInvitePolicy,
  lockWorkspaceCreationContext,
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
  explicitColor?: string
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
}

export interface CreatedWorkspace {
  id: string
  name: string
  color: string
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

/**
 * Canonical transaction-enlisted workspace creation primitive.
 *
 * The caller supplies the creation-policy snapshot. This function revalidates
 * that snapshot under the shared organization/user locks before inserting the
 * workspace, owner permission, and optional starter workflow atomically.
 */
/**
 * The workspace.create capability gate is the CALLER's responsibility, because
 * it must not run inside this transaction — see
 * {@link assertWorkspaceCreationCapability}. `createWorkspace` calls it before
 * opening its transaction; the only other entry point,
 * {@link createDefaultPersonalWorkspaceInTransaction}, passes both
 * `organizationId` and `observedOrganizationId` as `null` by construction, so
 * the gate is a no-op on that path rather than a skipped check.
 */
export async function createWorkspaceInTransaction(
  tx: DbOrTx,
  {
    userId,
    observedOrganizationId,
    name,
    skipDefaultWorkflow = false,
    explicitColor,
    organizationId,
    workspaceMode,
    billedAccountUserId,
  }: CreateWorkspaceParams
): Promise<CreatedWorkspace> {
  const workspaceId = generateId()
  const workflowId = generateId()
  const now = new Date()
  const color = explicitColor || getRandomWorkspaceColor()
  const lockedCreationContext = await lockWorkspaceCreationContext(tx, {
    userId,
    organizationId,
    observedOrganizationId,
  })
  const committedBilledAccountUserId =
    workspaceMode === WORKSPACE_MODE.ORGANIZATION
      ? lockedCreationContext.billedAccountUserId
      : billedAccountUserId

  await tx.insert(workspace).values({
    id: workspaceId,
    name,
    color,
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

  if (!skipDefaultWorkflow) {
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
    const { workflowState } = buildDefaultWorkflowArtifacts()
    await saveWorkflowToNormalizedTables(
      workflowId,
      workflowState,
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
    color,
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
   * Gate before opening the transaction, never inside it — see
   * {@link assertWorkspaceCreationCapability} for why the lock never protected
   * this read. Its `WorkspaceCreationCapabilityWithheldError` is thrown from the
   * same call stack as before, so `app/api/workspaces/route.ts` still projects
   * the identical capability refusal.
   */
  await assertWorkspaceCreationCapability({
    organizationId: params.organizationId,
    observedOrganizationId: params.observedOrganizationId,
  })

  let created: CreatedWorkspace
  try {
    created = await db.transaction((tx) => createWorkspaceInTransaction(tx, params))
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

/** The same default personal workspace a first visit would create. */
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
  })
}
