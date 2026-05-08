import { db, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { hasWorkflowChanged } from '@/lib/workflows/comparison'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowUtils')

export function createErrorResponse(error: string, status: number, code?: string) {
  return NextResponse.json(
    {
      error,
      code: code || error.toUpperCase().replace(/\s+/g, '_'),
    },
    { status }
  )
}

export function createSuccessResponse(data: any) {
  return NextResponse.json(data)
}

/**
 * Checks whether a deployed workflow has changes that require redeployment.
 * Compares the current persisted state (from normalized tables) against the
 * active deployment version state.
 *
 * This is the single source of truth for redeployment detection — used by
 * both the /deploy and /status endpoints to ensure consistent results.
 */
export async function checkNeedsRedeployment(workflowId: string): Promise<boolean> {
  const [active] = await db
    .select({ state: workflowDeploymentVersion.state })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .orderBy(desc(workflowDeploymentVersion.createdAt))
    .limit(1)

  if (!active?.state) return false

  const currentState = await loadWorkflowDeploymentSnapshot(workflowId)
  if (!currentState) return false

  return hasWorkflowChanged(currentState, active.state as WorkflowState)
}

/**
 * Verifies user's workspace permissions using the permissions table
 * @param userId User ID to check
 * @param workspaceId Workspace ID to check
 * @returns Permission type if user has access, null otherwise
 */
export async function verifyWorkspaceMembership(
  userId: string,
  workspaceId: string
): Promise<string | null> {
  try {
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)

    return permission
  } catch (error) {
    logger.error(`Error verifying workspace permissions for ${userId} in ${workspaceId}:`, error)
    return null
  }
}
