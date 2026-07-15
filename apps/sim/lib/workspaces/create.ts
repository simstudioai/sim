import { db } from '@sim/db'
import { permissions, type WorkspaceMode, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { PlatformEvents } from '@/lib/core/telemetry'
import type { DbOrTx } from '@/lib/db/types'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getRandomWorkspaceColor } from '@/lib/workspaces/colors'
import { WORKSPACE_MODE } from '@/lib/workspaces/policy'

const logger = createLogger('WorkspaceCreate')

export interface CreateWorkspaceRecordParams {
  userId: string
  name: string
  skipDefaultWorkflow?: boolean
  explicitColor?: string
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
  /**
   * Runs the insert against an existing transaction instead of opening a new one — for callers
   * that need workspace creation to be atomic with other writes (e.g. archiving a workspace that
   * would otherwise strand a member). Defaults to opening its own transaction against `db`.
   */
  executor?: DbOrTx
}

export interface CreatedWorkspaceRecord {
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

/**
 * Core workspace-creation write: inserts the workspace, its owner admin permission row, and
 * (unless skipped) a default starter workflow. Shared by the `POST /api/workspaces` route and
 * the workspace-archival safety net that auto-provisions a replacement workspace for a member
 * who would otherwise be left with zero workspaces.
 *
 * Fires the `workspaceCreated` telemetry event itself only when it manages its own transaction
 * (no `executor` passed). Callers that pass `executor` are joining an outer transaction that can
 * still roll back after this returns, so they own firing that event once their transaction commits.
 */
export async function createWorkspaceRecord({
  userId,
  name,
  skipDefaultWorkflow = false,
  explicitColor,
  organizationId,
  workspaceMode,
  billedAccountUserId,
  executor,
}: CreateWorkspaceRecordParams): Promise<CreatedWorkspaceRecord> {
  const workspaceId = generateId()
  const workflowId = generateId()
  const now = new Date()
  const color = explicitColor || getRandomWorkspaceColor()

  const run = async (tx: DbOrTx) => {
    await tx.insert(workspace).values({
      id: workspaceId,
      name,
      color,
      ownerId: userId,
      organizationId,
      workspaceMode,
      billedAccountUserId,
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

    if (
      workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
      billedAccountUserId &&
      billedAccountUserId !== userId
    ) {
      permissionRows.push({
        id: generateId(),
        entityType: 'workspace' as const,
        entityId: workspaceId,
        userId: billedAccountUserId,
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
      await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
    }

    logger.info(
      skipDefaultWorkflow
        ? `Created ${workspaceMode} workspace ${workspaceId} for user ${userId}`
        : `Created ${workspaceMode} workspace ${workspaceId} with initial workflow ${workflowId} for user ${userId}`
    )
  }

  try {
    if (executor) {
      await run(executor)
    } else {
      await db.transaction(run)
    }
  } catch (error) {
    logger.error(`Failed to create workspace ${workspaceId}:`, error)
    throw error
  }

  if (!executor) {
    try {
      PlatformEvents.workspaceCreated({ workspaceId, userId, name })
    } catch {
      // Telemetry should not fail the operation
    }
  }

  return {
    id: workspaceId,
    name,
    color,
    ownerId: userId,
    organizationId,
    workspaceMode,
    billedAccountUserId,
    allowPersonalApiKeys: true,
    createdAt: now,
    updatedAt: now,
  }
}
