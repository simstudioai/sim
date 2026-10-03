import { getUserOrganization } from '@/lib/billing/organizations/membership'
import type { StaticPermissionGroupCapability } from '@/lib/permission-groups/capabilities'
import {
  isOrganizationCapabilityWithheld,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'

/**
 * Whether the group governing `userId` withholds `capability`, for an action
 * that may or may not name a workspace.
 *
 * A workspace-scoped action is governed by the group targeting that workspace.
 * A user-global one — a personal API key, a CLI login with no workspace — falls
 * back to the organization's default group rather than going ungoverned, which
 * would leave the narrower scope as the unguarded one.
 *
 * Shared so that fallback cannot drift between the surfaces that mint the same
 * credential: `/api/users/me/api-keys`, `/api/cli/auth/approve`. It restates no
 * capability of its own — each caller names the one it enforces, and carries
 * the `permission-group-enforced:` annotation for it.
 *
 * Not in `capability-assertions.ts` on purpose: reading the caller's
 * organization membership reaches the billing graph, and that module is a
 * guarded root of `check:application-graph` precisely so the authorization
 * funnel never loads it.
 */
export async function isCapabilityWithheldForUser(
  userId: string,
  capability: StaticPermissionGroupCapability,
  workspaceId?: string
): Promise<boolean> {
  if (workspaceId) return isWorkspaceCapabilityWithheld(userId, workspaceId, capability)

  const membership = await getUserOrganization(userId)
  if (!membership?.organizationId) return false
  return isOrganizationCapabilityWithheld(membership.organizationId, capability)
}
