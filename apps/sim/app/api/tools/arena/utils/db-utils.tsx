import { db } from '@sim/db'
import { userArenaDetails, workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { WorkflowTokenLookup } from '@/app/api/tools/arena/utils/types'

/**
 * Get the arenaToken associated with a workflow's user.
 */
export async function getArenaTokenByWorkflowId(workflowId: string): Promise<WorkflowTokenLookup> {
  // 1. Look up the workflow to get userId
  const wf = await db
    .select({
      id: workflow.id,
      userId: workflow.userId,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (wf.length === 0) {
    return { found: false, reason: 'Workflow not found' }
  }

  const { userId } = wf[0]

  if (!userId) {
    return { found: false, reason: 'Workflow has no userId' }
  }

  // 2. Look up arena token in user_arena_details
  const details = await db
    .select({
      arenaToken: userArenaDetails.arenaToken,
    })
    .from(userArenaDetails)
    .where(eq(userArenaDetails.userIdRef, userId))
    .limit(1)

  if (details.length === 0 || !details[0].arenaToken) {
    return { found: false, reason: 'Arena token not found for user' }
  }

  return {
    found: true,
    workflowId,
    userId,
    arenaToken: details[0].arenaToken,
  }
}
