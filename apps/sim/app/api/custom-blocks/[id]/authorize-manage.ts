import { NextResponse } from 'next/server'
import {
  getCustomBlockManageContext,
  isCustomBlocksDeploymentEnabled,
} from '@/lib/workflows/custom-blocks/operations'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

export type ManageContext = NonNullable<Awaited<ReturnType<typeof getCustomBlockManageContext>>>

/**
 * Confirm the caller can manage (edit/delete) the block: admin of the block's
 * SOURCE workflow's workspace — matching who could publish it. Org admins/owners
 * hold admin on every org workspace, so they pass too; a workspace admin from a
 * different workspace does not, so they cannot alter another workspace's block or
 * its exposed outputs.
 */
export async function authorizeManage(
  userId: string,
  id: string
): Promise<{ error: NextResponse; ctx: null } | { error: null; ctx: ManageContext }> {
  const ctx = await getCustomBlockManageContext(id)
  if (!ctx) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }), ctx: null }

  if (!isCustomBlocksDeploymentEnabled()) {
    return {
      error: NextResponse.json(
        { error: 'Custom blocks are not enabled for this organization' },
        { status: 403 }
      ),
      ctx: null,
    }
  }

  if (!ctx.sourceWorkspaceId || !(await hasWorkspaceAdminAccess(userId, ctx.sourceWorkspaceId))) {
    return {
      error: NextResponse.json({ error: 'Admin permissions required' }, { status: 403 }),
      ctx: null,
    }
  }
  return { error: null, ctx }
}
