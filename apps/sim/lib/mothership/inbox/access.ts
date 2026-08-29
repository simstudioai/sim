import { NextResponse } from 'next/server'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

/**
 * Refuses the inbox when the caller's permission group withholds it.
 *
 * permission-group-enforced: inbox.use — the inbox routes are raw handlers with
 * inline queries rather than workspace operations, so the authorization funnel
 * never sees them. Returns a response instead of throwing to match how those
 * handlers already report refusals, and returns `null` when nothing withholds
 * the inbox so a caller can read it as a guard.
 */
export async function inboxWithheldResponse(
  userId: string,
  workspaceId: string
): Promise<NextResponse | null> {
  const permissionConfig = await getUserPermissionConfig(userId, workspaceId)
  if (!permissionConfig?.hideInboxTab) return null
  return NextResponse.json(
    { error: "The inbox is not available under your organization's permission group" },
    { status: 403 }
  )
}
