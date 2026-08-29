import { NextResponse } from 'next/server'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import {
  getUserPermissionConfig,
  getUserPermissionConfigForOrganization,
} from '@/ee/access-control/utils/permission-check'

const REFUSAL = "Managing API keys is not available under your organization's permission group"

/**
 * Refuses API-key management when the caller's permission group withholds it.
 *
 * permission-group-enforced: api_keys.manage — the key CRUD routes are raw
 * handlers with inline queries rather than workspace operations, so the
 * authorization funnel never sees them.
 *
 * This is also what closes the workspace-API-key pass-through. A workspace key
 * authorizes as the workspace and resolves no group, so the funnel's capability
 * gate does not apply to it; gating the minting of one keeps a governed member
 * from issuing themselves a credential that outranks their own group. Keys that
 * already exist keep working — revoking those is the admin's call, not
 * something a policy change should do silently.
 *
 * Returns a response rather than throwing, to match how these handlers already
 * report refusals, and `null` when nothing withholds the capability.
 */
export async function apiKeyManagementWithheldResponse(
  userId: string,
  workspaceId: string
): Promise<NextResponse | null> {
  const permissionConfig = await getUserPermissionConfig(userId, workspaceId)
  if (!permissionConfig?.hideApiKeysTab) return null
  return NextResponse.json({ error: REFUSAL }, { status: 403 })
}

/**
 * The same refusal for personal keys, which are user-global and so belong to no
 * workspace. Resolves the organization's default group, which is the group that
 * governs an organization-level action — the same resolution invitations use.
 */
export async function personalApiKeyManagementWithheldResponse(
  userId: string
): Promise<NextResponse | null> {
  const membership = await getUserOrganization(userId)
  if (!membership?.organizationId) return null

  const permissionConfig = await getUserPermissionConfigForOrganization(membership.organizationId)
  if (!permissionConfig?.hideApiKeysTab) return null
  return NextResponse.json({ error: REFUSAL }, { status: 403 })
}
