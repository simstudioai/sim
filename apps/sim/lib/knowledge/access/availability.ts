import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'

/**
 * Who is asking. Members mode — creating, switching, syncing, and honouring
 * member tokens — is judged by the workspace alone, because the member engine
 * has no person to speak for and every gate must agree with it. Retrieval
 * defaults pass the signed-in user as well, so the flag's platform-admin
 * clause lets an admin try hybrid retrieval anywhere; an actorless caller
 * (a schedule, a cron, a workspace API key) passes none.
 */
export interface KnowledgeMemberAccessContext {
  workspaceId: string
  userId?: string
}

/**
 * Whether permission-aware knowledge is on for this workspace: the
 * `knowledge-member-access` flag, and Credential Groups available to the
 * workspace, which members mode enrolls people through. Every gate the
 * feature has checks this one function — creating and switching connectors,
 * the member engine, the member tokens a reader is granted, and the
 * workspace host context the UI reads — so they can never disagree. When it
 * turns off, member-scoped documents are hidden on the next read, members-mode
 * connectors wait rather than change anything, and search returns to the
 * semantic-only default; nothing is deleted.
 */
export async function isKnowledgeMemberAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<boolean> {
  if (!(await isFeatureEnabled('knowledge-member-access', context))) return false
  const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(context.workspaceId)
  return isCredentialGroupsAvailable({ workspaceId: context.workspaceId, ownerBilling })
}
